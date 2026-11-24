import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { isAddress, type Address, type Hex } from "viem";
import { all, get, run, isUniqueViolation } from "./db";
import { accrue, release, withhold, mockPayments } from "./chain";

// Payments go through the TaskEscrow contract on Aevum, in three steps:
//   1. an accepted answer is recorded here as 'pending';
//   2. the sweep records it on chain (accrue): the requester's escrowed budget now owes it to the worker,
//      after the task's hold;
//   3. once the hold is over, the sweep releases it: tUSD8 lands in the worker's wallet. Anyone could release it,
//      so a worker is paid even if this app disappears.
// A worker who fails hidden checks during the hold has the payment withheld on chain, and it returns to the budget.

export const cooldownSecs = () => Number(process.env.PAYOUT_COOLDOWN_SECS ?? 60);

export function checkPayoutAddress(a: string): { ok: boolean; error?: string } {
  if (!isAddress(a, { strict: false })) return { ok: false, error: "That is not a wallet address. It starts with 0x and has 42 characters." };
  if (/^0x0{40}$/i.test(a)) return { ok: false, error: "That address cannot receive payments." };
  return { ok: true };
}

export async function payoutAddress(worker: string): Promise<Address | null> {
  const r = await get("SELECT payout_address a FROM workers WHERE pubkey=?", worker);
  return r?.a && isAddress(r.a, { strict: false }) ? (r.a as Address) : null;
}

export async function todayPaid(worker: string) {
  const since = Math.floor(Date.now() / 1000) - 86400;
  const r = (await get("SELECT COALESCE(SUM(micro),0) s FROM payouts WHERE worker=? AND status IN ('paid','onchain') AND created_at>?", worker, since))!;
  return r.s as number;
}

// Step 1: record an approved answer. UNIQUE(item_id, worker) = no double pay here, and the claim id does the same on chain.
export async function queuePayout(task: { id: string; reward_micro: number }, itemId: string, worker: string) {
  const now = Math.floor(Date.now() / 1000);
  try {
    await run("INSERT INTO payouts (id,item_id,task_id,worker,micro,status,created_at,release_at) VALUES (?,?,?,?,?,'pending',?,?)",
      randomUUID(), itemId, task.id, worker, task.reward_micro, now, now + cooldownSecs());
    return { status: "pending" as const, releaseAt: now + cooldownSecs() };
  } catch (e) { if (isUniqueViolation(e)) return { status: "duplicate" as const }; throw e; }
}

const flaggedWorker = async (taskId: string, worker: string) => !!(await get(`SELECT 1 FROM submissions s JOIN items i ON i.id=s.item_id
  WHERE s.task_id=? AND s.worker=? AND i.is_check=1 AND s.verdict='fail'
  AND s.attempt>=CASE WHEN (SELECT kind FROM tasks WHERE id=s.task_id)='rank' THEN 1 ELSE 3 END
  AND NOT EXISTS (SELECT 1 FROM submissions s2 WHERE s2.item_id=s.item_id AND s2.worker=s.worker AND s2.verdict='pass') LIMIT 1`, taskId, worker));

const short = (e: any) => String(e?.shortMessage || e?.message || "Payment failed").slice(0, 200);

// Statuses: pending (in this app only) -> onchain (held in the escrow) -> paid, or withheld, or failed.
let sweeping = false;
export async function releaseDue() {
  if (sweeping) return;
  sweeping = true;
  try {
    const cap = Number(process.env.DAILY_CAP_MICRO || 2_000_000);
    const now = Math.floor(Date.now() / 1000);

    // Step 2: record accepted answers on chain, one transaction per task.
    const fresh = await all(`SELECT p.*, w.payout_address addr FROM payouts p JOIN tasks t ON t.id=p.task_id
      LEFT JOIN workers w ON w.pubkey=p.worker
      WHERE p.status='pending' AND p.sending=0 AND t.status='open' ORDER BY p.created_at LIMIT 40`);
    const byTask = new Map<string, any[]>();
    for (const p of fresh) {
      if (!p.addr) continue; // stays here until the worker adds a payout address
      if (await flaggedWorker(p.task_id, p.worker)) { await run("UPDATE payouts SET status='withheld', error='Quality check failed on this task' WHERE id=?", p.id); continue; }
      if ((await todayPaid(p.worker)) + p.micro > cap) continue; // stays here until under the daily cap
      byTask.set(p.task_id, [...(byTask.get(p.task_id) || []), p]);
    }
    for (const [taskId, rows] of byTask) {
      const ids = rows.map((r) => r.id);
      const marked = await run(`UPDATE payouts SET sending=1 WHERE id IN (${ids.map(() => "?").join(",")}) AND sending=0`, ...ids);
      if (marked !== ids.length) { await run(`UPDATE payouts SET sending=0 WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids); continue; }
      if (mockPayments()) {
        for (const r of rows) await run("UPDATE payouts SET status='onchain', sending=0, claim_id=?, release_at=? WHERE id=?", "mock:" + r.id, now + cooldownSecs(), r.id);
        continue;
      }
      try {
        const out = await accrue(taskId, rows.map((r) => ({ itemId: r.item_id, worker: r.addr as Address, amount: r.micro })));
        for (const [i, r] of rows.entries()) {
          await run("UPDATE payouts SET status='onchain', sending=0, claim_id=?, accrue_tx=?, release_at=?, via=? WHERE id=?",
            out.claims[i].claimId, out.hash, out.claims[i].releaseAt, r.addr, r.id);
        }
      } catch (e) {
        const msg = short(e);
        for (const r of rows) await run("UPDATE payouts SET status='failed', sending=0, error=? WHERE id=?", `escrow: ${msg}`, r.id);
        // A budget problem stops the task, so workers are not sent to work that cannot be paid.
        if (/OverBudget|TaskInactive/.test(msg)) await run("UPDATE tasks SET status='paused', pause_reason=? WHERE id=? AND status='open'", "The task's escrowed budget cannot cover more answers.", taskId);
      }
    }

    // Quality checks can still fail during the hold: withhold those payments on chain.
    const held = await all("SELECT * FROM payouts WHERE status='onchain' AND sending=0 LIMIT 100");
    const bad: any[] = [];
    for (const p of held) if (p.release_at > now && (await flaggedWorker(p.task_id, p.worker))) bad.push(p);
    if (bad.length) {
      try {
        if (!mockPayments()) await withhold(bad.map((p) => p.claim_id as Hex));
        for (const p of bad) await run("UPDATE payouts SET status='withheld', error='Quality check failed on this task' WHERE id=?", p.id);
      } catch (e) { console.error("[payout] withhold failed:", short(e)); }
    }

    // Step 3: release what is due.
    const due = held.filter((p) => p.release_at <= now && !bad.includes(p));
    if (due.length) {
      if (mockPayments()) {
        for (const p of due) await run("UPDATE payouts SET status='paid', tx='mock' WHERE id=?", p.id);
      } else {
        try {
          const out = await release(due.map((p) => p.claim_id as Hex));
          const paid = new Set(out.paid.map((x) => x.toLowerCase()));
          for (const p of due) if (paid.has(String(p.claim_id).toLowerCase())) await run("UPDATE payouts SET status='paid', tx=? WHERE id=?", out.hash, p.id);
        } catch (e) { console.error("[payout] release failed:", short(e)); }
      }
    }
  } finally { sweeping = false; }
}

// Background sweep for API routes: a slow chain must never slow down workers.
// after() keeps the serverless function alive until the sweep finishes (a bare promise would be frozen on Vercel).
export const kickRelease = () => {
  const job = () => releaseDue().catch((e) => console.error("[payout] sweep failed:", e));
  try { after(job); } catch { void job(); } // outside a request (scripts/tests) there is nothing to extend
};
