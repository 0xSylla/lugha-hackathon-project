import { get, run } from "@/lib/db";
import { withAuth } from "@/lib/auth";
import { mockPayments, publicClient, readTask } from "@/lib/chain";

export const runtime = "nodejs";
export const maxDuration = 60;

// After the requester closed the escrow from their wallet, stop the task here too. Trusts the chain, not the request.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withAuth(req, async (pk, b) => {
    const t = await get("SELECT * FROM tasks WHERE id=?", id);
    if (!t || t.requester !== pk) throw new Error("Not your task");
    if (!mockPayments() && t.funder !== "demo") {
      if (/^0x[0-9a-fA-F]{64}$/.test(String(b.tx || ""))) await publicClient.waitForTransactionReceipt({ hash: b.tx, timeout: 60_000 }).catch(() => null);
      const c = await readTask(id);
      if (!c.closed) throw new Error("The escrow is still open on chain. Close it from your wallet first.");
    }
    await run("UPDATE tasks SET status='closed', pause_reason=NULL WHERE id=?", id);
    // Answers approved here but never recorded on chain can no longer be paid from a closed escrow.
    const dropped = await run("UPDATE payouts SET status='failed', error='escrow: the requester closed this task before this answer was recorded on chain' WHERE task_id=? AND status='pending'", id);
    return { closed: true, dropped };
  });
}
