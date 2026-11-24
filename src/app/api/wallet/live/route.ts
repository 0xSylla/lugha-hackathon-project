import type { Address } from "viem";
import { get } from "@/lib/db";
import { withAuth } from "@/lib/auth";
import { mockPayments, tusdBalance } from "@/lib/chain";

export const runtime = "nodejs";
export const maxDuration = 30;

// The worker's tUSD8 balance, read from Aevum. Read-only: this app never holds a key to the worker's wallet.
export async function GET(req: Request) {
  return withAuth(req, async (pk) => {
    const w = await get("SELECT payout_address a FROM workers WHERE pubkey=?", pk);
    if (!w?.a) return { address: null, balance: null };
    if (mockPayments()) return { address: w.a, balance: null, simulated: true };
    try { return { address: w.a, balance: await tusdBalance(w.a as Address) }; }
    catch { throw new Error("We could not reach Aevum to read your balance. Try again in a moment."); }
  });
}
