import { get, run } from "@/lib/db";
import { withAuth } from "@/lib/auth";
import { releaseDue } from "@/lib/payout";
import { mockPayments, readTask } from "@/lib/chain";

export const runtime = "nodejs";
export const maxDuration = 60; // the payout sweep can send on-chain transactions

// Requester resumes a paused task. It reopens only if its escrow on Aevum can still pay, and failed payments are retried.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withAuth(req, async (pk) => {
    const t = await get("SELECT * FROM tasks WHERE id=?", id);
    if (!t || t.requester !== pk) throw new Error("Not your task");
    let available: number | null = null;
    if (!mockPayments() && t.funder !== "demo") {
      const c = await readTask(id);
      if (c.closed) throw new Error("This task's escrow was closed and its budget refunded. Post a new task.");
      if (c.paused) throw new Error("The escrow is paused from your wallet. Unpause it on chain first.");
      if (c.available < t.reward_micro) throw new Error("The escrow has no budget left for another answer.");
      available = c.available;
    }
    await run("UPDATE tasks SET status='open', pause_reason=NULL WHERE id=? AND status<>'closed'", id);
    const retried = await run("UPDATE payouts SET status='pending', sending=0, error=NULL WHERE task_id=? AND status='failed' AND error LIKE 'escrow:%'", id);
    await releaseDue();
    return { resumed: true, available, retried };
  });
}
