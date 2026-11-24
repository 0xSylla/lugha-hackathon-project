import { get } from "@/lib/db";
import { withAuth } from "@/lib/auth";
import { mockPayments, readTask } from "@/lib/chain";

export const runtime = "nodejs";
export const maxDuration = 30;

// What the task's escrow still holds, read from the contract, next to what the task may still pay.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withAuth(req, async (pk) => {
    const t = await get("SELECT * FROM tasks WHERE id=?", id);
    if (!t || t.requester !== pk) throw new Error("Not your task");

    const items = (await get("SELECT COUNT(*) c FROM items WHERE task_id=?", id))!.c as number;
    const slots = items * t.answers_per_item;
    const taken = (await get("SELECT COUNT(*) c FROM payouts WHERE task_id=? AND item_id NOT LIKE 'rev:%' AND status IN ('paid','pending','onchain')", id))!.c as number;
    const revTaken = (await get("SELECT COUNT(*) c FROM payouts WHERE task_id=? AND item_id LIKE 'rev:%' AND status IN ('paid','pending','onchain')", id))!.c as number;
    const heldMicro = (await get("SELECT COALESCE(SUM(micro),0) s FROM payouts WHERE task_id=? AND status IN ('pending','onchain')", id))!.s as number;
    const paidMicro = (await get("SELECT COALESCE(SUM(micro),0) s FROM payouts WHERE task_id=? AND status='paid'", id))!.s as number;
    const remainingMicro = Math.max(0, slots - taken) * t.reward_micro + (t.review_micro ? Math.max(0, slots - revTaken) * t.review_micro : 0);
    const base = { heldMicro, paidMicro, remainingMicro, needed: heldMicro + remainingMicro, funder: t.funder, fundTx: t.fund_tx, status: t.status };
    if (mockPayments() || t.funder === "demo") return { ...base, simulated: true };

    const c = await readTask(id);
    if (!c.exists) throw new Error("This task has no escrow on Aevum.");
    // Escrowed = budget nobody has earned yet + payments on hold. Answers still waiting here are paid from `available`.
    const short = Math.max(0, base.needed - (c.available + c.held));
    return { ...base, escrow: { available: c.available, held: c.held, paused: c.paused, closed: c.closed }, short, funded: short === 0 };
  });
}
