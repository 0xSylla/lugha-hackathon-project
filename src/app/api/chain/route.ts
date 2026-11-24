import { escrowAddress, mockPayments, operatorAddress } from "@/lib/chain";
import { cooldownSecs } from "@/lib/payout";
import { AEVUM_CHAIN_ID, TUSD8 } from "@/lib/aevum";

export const runtime = "nodejs";

// What a requester's wallet needs to fund a task: the escrow, the operator written into the task terms, and the hold.
export async function GET() {
  if (mockPayments()) return Response.json({ mock: true, chainId: AEVUM_CHAIN_ID, token: TUSD8, holdSecs: cooldownSecs() });
  return Response.json({ mock: false, chainId: AEVUM_CHAIN_ID, token: TUSD8, escrow: escrowAddress(), operator: operatorAddress(), holdSecs: cooldownSecs() });
}
