import { all, get, run } from "@/lib/db";
import { withAuth } from "@/lib/auth";
import { todayPaid, kickRelease, checkPayoutAddress } from "@/lib/payout";
import { reputation } from "@/lib/reputation";

export const runtime = "nodejs";
export const maxDuration = 60; // the payout sweep can send on-chain transactions

export async function GET(req: Request) {
  return withAuth(req, async (pk) => {
    kickRelease();
    const w = await get("SELECT payout_address a FROM workers WHERE pubkey=?", pk);
    const payouts = await all("SELECT p.id,p.micro,p.status,p.error,p.created_at,p.release_at,p.sending,p.tx,p.accrue_tx,t.title FROM payouts p JOIN tasks t ON t.id=p.task_id WHERE p.worker=? ORDER BY p.created_at DESC LIMIT 50", pk);
    const total = (await get("SELECT COALESCE(SUM(micro),0) s FROM payouts WHERE worker=? AND status='paid'", pk))!.s;
    const mine = await all(`SELECT t.id,t.title,t.kind,t.status,t.pause_reason,t.funder,t.fund_tx,
      (SELECT COUNT(*) FROM items i WHERE i.task_id=t.id AND i.is_check=0) items,
      (SELECT COUNT(*) FROM payouts p WHERE p.task_id=t.id AND p.status='paid') paid FROM tasks t WHERE t.requester=? ORDER BY t.created_at DESC`, pk);
    return { address: w?.a || "", pubkey: pk, reputation: await reputation(pk), total, today: await todayPaid(pk), cap: Number(process.env.DAILY_CAP_MICRO || 2_000_000), payouts, myTasks: mine };
  });
}

// Save the wallet address payouts go to. Payments waiting for an address are sent on the next sweep.
export async function POST(req: Request) {
  return withAuth(req, async (pk, b) => {
    const a = String(b.address || "").trim();
    const c = checkPayoutAddress(a);
    if (!c.ok) throw new Error(c.error);
    await run("INSERT INTO workers (pubkey,payout_address) VALUES (?,?) ON CONFLICT(pubkey) DO UPDATE SET payout_address=EXCLUDED.payout_address", pk, a.toLowerCase());
    // Payments that failed on chain are retried; payments still on hold keep the address they were recorded with.
    const retried = await run("UPDATE payouts SET status='pending', sending=0, error=NULL WHERE worker=? AND status='failed'", pk);
    kickRelease();
    return { ok: true, retried };
  });
}
