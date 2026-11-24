// Server only: talks to the TaskEscrow contract on Aevum with the operator's key.
// The operator records accepted answers, releases due payments and relays the requester's signed funding.
// The contract stops it from paying anything but the task's fixed rates, to anyone but the workers.
import { createPublicClient, createWalletClient, http, isAddress, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { aevum, createNonce, itemRefOf, taskIdOf, TUSD8, type Terms } from "./aevum";
import { escrowAbi } from "./escrow-abi";

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const mockPayments = () => process.env.MOCK_PAYMENTS === "1";

const rpc = () => process.env.AEVUM_RPC || aevum.rpcUrls.default.http[0];
export const publicClient = createPublicClient({ chain: aevum, transport: http(rpc(), { timeout: 20_000 }) });

export function escrowAddress(): Address {
  const a = process.env.ESCROW_ADDRESS || process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "";
  if (!isAddress(a)) throw new Error("ESCROW_ADDRESS is not set to the deployed TaskEscrow address");
  return a;
}

function operatorAccount() {
  const k = process.env.OPERATOR_PRIVATE_KEY || "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("OPERATOR_PRIVATE_KEY is missing or malformed");
  return privateKeyToAccount(k as Hex);
}

/** The operator's public address. Safe to show: requesters sign it into their task terms. */
export const operatorAddress = (): Address => operatorAccount().address;

const wallet = () => createWalletClient({ account: operatorAccount(), chain: aevum, transport: http(rpc(), { timeout: 20_000 }) });

// One operator key sends every transaction, so they go out one at a time (per server instance) to keep nonces in order.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function send(functionName: string, args: readonly unknown[]): Promise<{ hash: Hex; logs: any[] }> {
  return serial(async () => {
    const w = wallet();
    const { request } = await publicClient.simulateContract({
      account: w.account,
      address: escrowAddress(),
      abi: escrowAbi,
      functionName: functionName as any,
      args: args as any,
    });
    const hash = await w.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
    return { hash, logs: parseEventLogs({ abi: escrowAbi, logs: receipt.logs }) };
  });
}

// ------------------------------------------------------------------ funding

export type SignedFunding = {
  requester: Address;
  budget: string; // micro tUSD8, as a decimal string
  validAfter: string;
  validBefore: string;
  signature: Hex;
};

/** Create and fund the task on chain with the requester's EIP-3009 signature. The operator pays the gas. */
export async function createFundedTask(taskUuid: string, terms: Terms, f: SignedFunding) {
  if (!isAddress(f.requester)) throw new Error("The funding wallet address is not valid");
  if (f.requester.toLowerCase() === terms.operator.toLowerCase()) throw new Error("The requester cannot be the operator");
  const sig = f.signature;
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error("The wallet signature is malformed");
  const r = `0x${sig.slice(2, 66)}` as Hex, s = `0x${sig.slice(66, 130)}` as Hex;
  let v = parseInt(sig.slice(130, 132), 16);
  if (v < 27) v += 27;
  // Not strictly needed (the token checks the signature), but a clear error beats a revert.
  const nonce = createNonce(escrowAddress(), taskUuid, f.requester, terms);
  const out = await send("createTaskWithAuthorization", [
    taskIdOf(taskUuid),
    f.requester,
    terms,
    BigInt(f.budget),
    { validAfter: BigInt(f.validAfter), validBefore: BigInt(f.validBefore), v, r, s },
  ]);
  return { hash: out.hash, nonce };
}

// ------------------------------------------------------------------ payouts

export type ToAccrue = { itemId: string; worker: Address; amount: number };

/** Record accepted answers on chain. Returns the claim id of each, in order. */
export async function accrue(taskUuid: string, rows: ToAccrue[]) {
  const out = await send("accrue", [
    taskIdOf(taskUuid),
    rows.map((r) => itemRefOf(r.itemId)),
    rows.map((r) => r.worker),
    rows.map((r) => BigInt(r.amount)),
  ]);
  const accrued = out.logs.filter((l) => l.eventName === "Accrued");
  return { hash: out.hash, claims: accrued.map((l) => ({ claimId: l.args.claimId as Hex, releaseAt: Number(l.args.releaseAt) })) };
}

export const withhold = (claimIds: Hex[]) => send("withhold", [claimIds]);

/** Pay every listed claim whose hold is over. Returns the claim ids actually paid. */
export async function release(claimIds: Hex[]) {
  const out = await send("release", [claimIds]);
  const paid = out.logs.filter((l) => l.eventName === "Released").map((l) => l.args.claimId as Hex);
  return { hash: out.hash, paid };
}

export const anchorDataset = (taskUuid: string, sha256Hex: string) =>
  send("anchorDataset", [taskIdOf(taskUuid), `0x${sha256Hex}` as Hex]);

// ------------------------------------------------------------------ reads

export async function readTask(taskUuid: string) {
  const t = await publicClient.readContract({ address: escrowAddress(), abi: escrowAbi, functionName: "taskOf", args: [taskIdOf(taskUuid)] });
  return {
    requester: t.requester,
    available: Number(t.available),
    held: Number(t.held),
    paused: t.paused,
    closed: t.closed,
    exists: t.requester !== "0x0000000000000000000000000000000000000000",
  };
}

export async function tusdBalance(a: Address) {
  return Number(await publicClient.readContract({ address: TUSD8, abi: erc20Abi, functionName: "balanceOf", args: [a] }));
}
