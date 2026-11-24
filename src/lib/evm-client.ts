"use client";
// Browser side of the Aevum payments.
// - Requesters fund a task from their own browser wallet (MetaMask, Rabby…) by signing one message: no gas, no
//   transaction to send themselves. The app relays it to the escrow contract.
// - Workers get paid to an address. They can paste one, or create one here: the key is generated and kept on this
//   device, like their sign-in key, and can be exported to a real wallet at any time.
import { createWalletClient, custom, getAddress, numberToHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { aevum, createNonce, fundingTypedData, AEVUM_CHAIN_ID, type Terms } from "./aevum";

export type ChainConfig = { mock: boolean; chainId: number; token: Address; escrow?: Address; operator?: Address; holdSecs: number };

let cfg: Promise<ChainConfig> | null = null;
export const chainConfig = () => (cfg ??= fetch("/api/chain").then((r) => r.json()));

const eth = () => (window as any).ethereum as { request: (a: { method: string; params?: unknown[] }) => Promise<any> } | undefined;
export const hasBrowserWallet = () => typeof window !== "undefined" && !!eth();

/** Connects the browser wallet and makes sure it is on Aevum testnet (adds the network if needed). */
export async function connectBrowserWallet(): Promise<Address> {
  const p = eth();
  if (!p) throw new Error("No browser wallet found. Install MetaMask or Rabby, or open this page in your wallet's browser.");
  const [a] = (await p.request({ method: "eth_requestAccounts" })) as string[];
  if (!a) throw new Error("The wallet did not share an account.");
  const current = Number(await p.request({ method: "eth_chainId" }));
  if (current !== AEVUM_CHAIN_ID) {
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(AEVUM_CHAIN_ID) }] });
    } catch (e: any) {
      if (e?.code !== 4902 && !/unrecognized|not been added|unknown chain/i.test(String(e?.message))) throw new Error("Switch your wallet to QDay Aevum Testnet and try again.");
      await p.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: numberToHex(AEVUM_CHAIN_ID),
          chainName: aevum.name,
          nativeCurrency: aevum.nativeCurrency,
          rpcUrls: aevum.rpcUrls.default.http,
          blockExplorerUrls: [aevum.blockExplorers!.default.url],
        }],
      });
    }
  }
  return getAddress(a);
}

export type SignedFunding = { requester: Address; budget: string; validAfter: string; validBefore: string; signature: Hex };

/**
 * Asks the requester's wallet to sign the transfer of `budget` into the escrow for this task.
 * The signature only works for these exact terms: a change to the operator, rates, cap or hold voids it.
 */
export async function signFunding(taskUuid: string, budget: number, t: { reward: number; review: number; maxPerWorker: number }): Promise<SignedFunding> {
  const c = await chainConfig();
  if (c.mock || !c.escrow || !c.operator) throw new Error("Payments are simulated on this server.");
  const requester = await connectBrowserWallet();
  const terms: Terms = {
    operator: c.operator,
    reward: BigInt(t.reward),
    reviewReward: BigInt(t.review),
    maxPerWorker: BigInt(t.maxPerWorker),
    holdSecs: BigInt(c.holdSecs),
  };
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 30 * 60); // the signature expires after 30 minutes
  const td = fundingTypedData({ escrow: c.escrow, requester, budget: BigInt(budget), validAfter: 0n, validBefore, nonce: createNonce(c.escrow, taskUuid, requester, terms) });
  const wallet = createWalletClient({ account: requester, chain: aevum, transport: custom(eth()!) });
  let signature: Hex;
  try { signature = await wallet.signTypedData(td); }
  catch (e: any) { throw new Error(/reject|denied|cancel/i.test(String(e?.message)) ? "You closed the wallet without signing. Nothing was sent." : String(e?.shortMessage || e?.message)); }
  return { requester, budget: String(budget), validAfter: "0", validBefore: validBefore.toString(), signature };
}

// ------------------------------------------------------------------ worker payout wallet on this device

const KEY = "sfd_evm_sk";

export function deviceWallet(): Address | null {
  try { const k = localStorage.getItem(KEY); return k ? privateKeyToAccount(k as Hex).address : null; } catch { return null; }
}

export function createDeviceWallet(): Address {
  const existing = deviceWallet();
  if (existing) return existing;
  const k = generatePrivateKey();
  localStorage.setItem(KEY, k);
  return privateKeyToAccount(k).address;
}

/** The private key, so the worker can import this wallet into MetaMask or Rabby and spend what they earned. */
export function exportDeviceWallet(): Hex | null {
  try { return (localStorage.getItem(KEY) as Hex) || null; } catch { return null; }
}

// ------------------------------------------------------------------ requester: close a task and take back the budget

/**
 * Closes the task's escrow from the requester's own wallet: whatever nobody has earned goes back to them, and
 * payments already owed to workers stay owed. Only the requester can do this, so it costs them a little gas (tQDAY).
 */
export async function closeEscrow(taskUuid: string): Promise<Hex> {
  const c = await chainConfig();
  if (c.mock || !c.escrow) throw new Error("Payments are simulated on this server.");
  const account = await connectBrowserWallet();
  const { escrowAbi } = await import("./escrow-abi");
  const { taskIdOf } = await import("./aevum");
  const wallet = createWalletClient({ account, chain: aevum, transport: custom(eth()!) });
  try {
    return await wallet.writeContract({ address: c.escrow, abi: escrowAbi, functionName: "close", args: [taskIdOf(taskUuid)] });
  } catch (e: any) {
    const m = String(e?.shortMessage || e?.message);
    if (/NotRequester/.test(m)) throw new Error("Connect the wallet that funded this task.");
    if (/reject|denied|cancel/i.test(m)) throw new Error("You closed the wallet without confirming. Nothing changed.");
    if (/insufficient funds|gas/i.test(m)) throw new Error("Your wallet needs a little tQDAY for gas (free from the QDay faucet).");
    throw new Error(m);
  }
}
