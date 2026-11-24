// Shared by the browser and the server: the Aevum chain, how app ids map to on-chain ids, and the message a
// requester signs to fund a task without gas. Holds no secret.
import { defineChain, encodeAbiParameters, keccak256, stringToHex, type Address, type Hex } from "viem";

export const AEVUM_CHAIN_ID = 44005;
export const TUSD8: Address = "0x456569838f1d43009A91ebA4263147Afd7233483";
export const TUSD8_DECIMALS = 6;
export const EXPLORER = "https://explorer-test.qday.info";

export const aevum = defineChain({
  id: AEVUM_CHAIN_ID,
  name: "QDay Aevum Testnet",
  nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc-test.qday.info"] } },
  blockExplorers: { default: { name: "Aevum Explorer", url: EXPLORER } },
  testnet: true,
});

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;

/** App task ids (UUIDs) and item ids become bytes32 on chain. */
export const taskIdOf = (uuid: string): Hex => keccak256(stringToHex(`task:${uuid}`));
export const itemRefOf = (itemId: string): Hex => keccak256(stringToHex(`item:${itemId}`));

/** Amounts are kept in micro-dollars: tUSD8 has 6 decimals, so 1 tUSD8 = 1_000_000. */
export const MICRO = 1_000_000;
export const toUsd = (micro: number) => micro / MICRO;
export const fmtUsd = (micro: number) => {
  const v = micro / MICRO;
  if (v === 0) return "$0";
  // Two decimals like any dollar price; a third only for sub-dime amounts that need it ($0.015).
  return "$" + (v < 0.1 && Math.round(v * 1000) % 10 !== 0 ? v.toFixed(3) : v.toFixed(2));
};

export type Terms = { operator: Address; reward: bigint; reviewReward: bigint; maxPerWorker: bigint; holdSecs: bigint };

const termsTuple = {
  type: "tuple",
  components: [
    { name: "operator", type: "address" },
    { name: "reward", type: "uint128" },
    { name: "reviewReward", type: "uint128" },
    { name: "maxPerWorker", type: "uint128" },
    { name: "holdSecs", type: "uint64" },
  ],
} as const;

/** Same as TaskEscrow.createNonce: binds the signed transfer to every term of the task. */
export function createNonce(escrow: Address, taskUuid: string, requester: Address, terms: Terms): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }, { type: "address" }, termsTuple],
      [escrow, taskIdOf(taskUuid), requester, terms],
    ),
  );
}

/** The EIP-3009 ReceiveWithAuthorization message the requester signs in their wallet (EIP-712). */
export function fundingTypedData(a: {
  escrow: Address;
  requester: Address;
  budget: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}) {
  return {
    domain: { name: "tUSD8", version: "2", chainId: AEVUM_CHAIN_ID, verifyingContract: TUSD8 },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization" as const,
    message: {
      from: a.requester,
      to: a.escrow,
      value: a.budget,
      validAfter: a.validAfter,
      validBefore: a.validBefore,
      nonce: a.nonce,
    },
  };
}

/** Everything a task can cost: every answer slot at the reward, plus one verification per slot for voice tasks. */
export const taskBudget = (slots: number, reward: number, review: number | null) => slots * reward + (review ? slots * review : 0);
