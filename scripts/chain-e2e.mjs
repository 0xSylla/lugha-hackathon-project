// End-to-end test of the money path on a LOCAL FORK of QDay Aevum testnet (real tUSD8, nothing leaves the machine).
// It drives the app through its API like a requester and a worker would, then checks every result on chain.
//
//   anvil --fork-url https://rpc-test.qday.info --hardfork shanghai --chain-id 44005 --port 8545
//   (deploy TaskEscrow on the fork, start the app with MOCK_PAYMENTS=0, AEVUM_RPC=http://127.0.0.1:8545)
//   REQUESTER_KEY=0x... node scripts/chain-e2e.mjs      # a key holding tUSD8 on the fork
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { createHash, randomUUID } from "node:crypto";
import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, stringToHex, defineChain } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const B = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const RPC = process.env.AEVUM_RPC || "http://127.0.0.1:8545";
const TUSD8 = "0x456569838f1d43009A91ebA4263147Afd7233483";
const chain = defineChain({ id: 44005, name: "Aevum fork", nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, detail = "") => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : "  → " + detail}`); };

// ---- signed API calls (same scheme as the app: NIP-98 style events)
function authHeader(sk, path, method, rawBody) {
  const tags = [["u", B + path], ["method", method]];
  if (rawBody) tags.push(["payload", createHash("sha256").update(rawBody).digest("hex")]);
  const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: "" }, sk);
  return "Nostr " + Buffer.from(JSON.stringify(ev)).toString("base64");
}
async function call(sk, path, method = "GET", body, raw = false) {
  const rb = body ? JSON.stringify(body) : "";
  const r = await fetch(B + path, { method, body: rb || undefined, headers: { authorization: authHeader(sk, path, method, rb), "content-type": "application/json" } });
  if (raw) return r;
  const t = await r.text(); try { return JSON.parse(t); } catch { return { _text: t, _status: r.status }; }
}

// ---- the same nonce and typed data as src/lib/aevum.ts (kept independent on purpose: this checks that file)
const taskIdOf = (u) => keccak256(stringToHex(`task:${u}`));
const termsTuple = { type: "tuple", components: [{ name: "operator", type: "address" }, { name: "reward", type: "uint128" }, { name: "reviewReward", type: "uint128" }, { name: "maxPerWorker", type: "uint128" }, { name: "holdSecs", type: "uint64" }] };
const nonceOf = (escrow, uuid, requester, terms) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }, { type: "address" }, termsTuple], [escrow, taskIdOf(uuid), requester, terms]));
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const escrowAbi = [
  { type: "function", name: "datasetHash", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "close", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
];
const bal = (a) => pub.readContract({ address: TUSD8, abi: erc20, functionName: "balanceOf", args: [a] }).then(Number);

const requester = privateKeyToAccount(process.env.REQUESTER_KEY);
const R = generateSecretKey(), W = generateSecretKey();
const workerAddr = privateKeyToAccount(generatePrivateKey()).address;

console.log(`Testing ${B} on ${RPC}\n`);
const cfg = await (await fetch(B + "/api/chain")).json();
ok("the app runs real payments on Aevum", cfg.mock === false && !!cfg.escrow && !!cfg.operator, JSON.stringify(cfg));

// ---- 1. requester funds a task with one signature, no gas
console.log("\nFunding");
const id = randomUUID();
const REWARD = 200_000; // $0.20
const items = [{ prompt: "How are you today?" }, { prompt: "Where is the market?" }];
const checks = [{ prompt: "Good morning", answer: "Good morning" }];
const itemCount = items.length + checks.length, slots = itemCount * 1, budget = slots * REWARD;
const terms = { operator: cfg.operator, reward: BigInt(REWARD), reviewReward: 0n, maxPerWorker: BigInt(itemCount * REWARD), holdSecs: BigInt(cfg.holdSecs) };
const validBefore = BigInt(Math.floor(Date.now() / 1000) + 1800);
const signature = await requester.signTypedData({
  domain: { name: "tUSD8", version: "2", chainId: 44005, verifyingContract: TUSD8 },
  types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
  primaryType: "ReceiveWithAuthorization",
  message: { from: requester.address, to: cfg.escrow, value: BigInt(budget), validAfter: 0n, validBefore, nonce: nonceOf(cfg.escrow, id, requester.address, terms) },
});
const reqBefore = await bal(requester.address), gasBefore = await pub.getBalance({ address: requester.address });
const event = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [["d", `lugha:${id}`]], content: "{}" }, R);
const funding = { requester: requester.address, budget: String(budget), validAfter: "0", validBefore: validBefore.toString(), signature };

// a tampered budget must be refused before anything happens on chain
const bad = await call(R, "/api/tasks", "POST", { id: randomUUID(), event, title: "x", kind: "translate", src: "English", dst: "Nigerian Pidgin", reward: REWARD, answersPerItem: 1, items, checks, funding: { ...funding, budget: String(budget * 10) } });
ok("a signature for another budget is refused", !!bad.error, JSON.stringify(bad));

const created = await call(R, "/api/tasks", "POST", { id, event, title: "Chain E2E translate", kind: "translate", src: "English", dst: "Nigerian Pidgin", reward: REWARD, answersPerItem: 1, items, checks, funding });
ok("the task is created and funded on chain", !!created.fundTx && created.budget === budget, JSON.stringify(created));
ok("the budget left the requester's wallet", reqBefore - (await bal(requester.address)) === budget);
ok("the requester paid no gas", (await pub.getBalance({ address: requester.address })) === gasBefore);
const escrowHeld = await bal(cfg.escrow);
ok("the escrow holds the budget", escrowHeld >= budget, String(escrowHeld));

// ---- 2. a worker answers; payments wait for a payout address, then go through the escrow
console.log("\nWork and payment");
const GOOD = { "How are you today?": "How you dey today?", "Where is the market?": "Where market dey?", "Good morning": "Good morning" };
let passed = 0;
for (let i = 0; i < itemCount; i++) {
  const n = await call(W, `/api/tasks/${id}`);
  if (!n.item) break;
  await sleep(Number(process.env.MIN_ANSWER_SECS ?? 3) * 1000 + 300);
  const s = await call(W, "/api/submit", "POST", { itemId: n.item.id, answer: GOOD[n.item.prompt] });
  if (s.pass) passed++;
}
ok(`the worker's ${itemCount} answers are accepted`, passed === itemCount, String(passed));
await call(W, "/api/wallet"); await sleep(1500);
let w = await call(W, "/api/wallet");
ok("without a payout address, nothing is sent", w.payouts.length === itemCount && w.payouts.every((p) => p.status === "pending"), JSON.stringify(w.payouts.map((p) => p.status)));
const saved = await call(W, "/api/wallet", "POST", { address: workerAddr });
ok("the worker saves a payout address", saved.ok === true, JSON.stringify(saved));

const deadline = Date.now() + (cfg.holdSecs + 90) * 1000;
let sawOnchain = false;
while (Date.now() < deadline) {
  w = await call(W, "/api/wallet");
  if (w.payouts.some((p) => p.status === "onchain")) sawOnchain = true;
  if (w.payouts.length && w.payouts.every((p) => p.status === "paid")) break;
  await sleep(3000);
}
ok("payments are locked in the escrow during the hold", sawOnchain);
ok("every payment ends up paid", w.payouts.length === itemCount && w.payouts.every((p) => p.status === "paid"), JSON.stringify(w.payouts.map((p) => [p.status, p.error])));
ok("each paid row links a real transaction", w.payouts.length > 0 && w.payouts.every((p) => /^0x[0-9a-f]{64}$/i.test(p.tx || "")));
const got = await bal(workerAddr);
ok(`the worker's wallet received ${itemCount} × $0.20 in tUSD8`, got === itemCount * REWARD, String(got));
const live = await call(W, "/api/wallet/live");
ok("the wallet page reads the same balance from chain", live.balance === got, JSON.stringify(live));

// ---- 3. export: the dataset hash is anchored in the escrow
console.log("\nDataset provenance");
const ex = await call(R, `/api/export/${id}?format=jsonl&attest=1`, "GET", undefined, true);
const sha = ex.headers.get("x-dataset-sha256"), anchorTx = ex.headers.get("x-aevum-tx");
const body = Buffer.from(await ex.arrayBuffer());
ok("the export's hash matches its content", createHash("sha256").update(body).digest("hex") === sha);
ok("the export is anchored on chain", !!anchorTx, ex.headers.get("x-aevum-error") || "");
const onchainHash = await pub.readContract({ address: cfg.escrow, abi: escrowAbi, functionName: "datasetHash", args: [taskIdOf(id)] });
ok("the contract stores that exact hash", onchainHash === `0x${sha}`, `${onchainHash} vs ${sha}`);

// ---- 4. the requester closes the task; nothing is left behind
console.log("\nClose");
const fund = await call(R, `/api/tasks/${id}/funding`);
ok("the funding check reads the escrow", fund.escrow && fund.escrow.held === 0 && fund.paidMicro === itemCount * REWARD, JSON.stringify(fund));
const wallet = createWalletClient({ account: requester, chain, transport: http(RPC) });
const before = await bal(requester.address);
const tx = await wallet.writeContract({ address: cfg.escrow, abi: escrowAbi, functionName: "close", args: [taskIdOf(id)] });
const closed = await call(R, `/api/tasks/${id}/close`, "POST", { tx });
ok("the app records the close after checking the chain", closed.closed === true, JSON.stringify(closed));
ok("the unused budget went back to the requester", (await bal(requester.address)) - before === budget - itemCount * REWARD, String((await bal(requester.address)) - before));
const after = await call(W, `/api/tasks/${id}`);

// a task nobody worked on: closing it returns the whole budget
const id2 = randomUUID();
const terms2 = { ...terms };
const sig2 = await requester.signTypedData({
  domain: { name: "tUSD8", version: "2", chainId: 44005, verifyingContract: TUSD8 },
  types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
  primaryType: "ReceiveWithAuthorization",
  message: { from: requester.address, to: cfg.escrow, value: BigInt(budget), validAfter: 0n, validBefore, nonce: nonceOf(cfg.escrow, id2, requester.address, terms2) },
});
const ev2 = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [["d", `lugha:${id2}`]], content: "{}" }, R);
const c2 = await call(R, "/api/tasks", "POST", { id: id2, event: ev2, title: "Chain E2E unused", kind: "translate", src: "English", dst: "Nigerian Pidgin", reward: REWARD, answersPerItem: 1, items, checks,
  funding: { requester: requester.address, budget: String(budget), validAfter: "0", validBefore: validBefore.toString(), signature: sig2 } });
ok("a second task is funded", !!c2.fundTx, JSON.stringify(c2));
const b2 = await bal(requester.address);
const tx2 = await wallet.writeContract({ address: cfg.escrow, abi: escrowAbi, functionName: "close", args: [taskIdOf(id2)] });
await call(R, `/api/tasks/${id2}/close`, "POST", { tx: tx2 });
ok("closing an untouched task returns the whole budget", (await bal(requester.address)) - b2 === budget, String((await bal(requester.address)) - b2));
const notMine = await call(W, `/api/tasks/${id2}/close`, "POST", {});
ok("only the requester can close a task in the app", !!notMine.error);
ok("a closed task takes no more work", after.item == null);

console.log(`\n${fails ? `${fails} FAILED` : "All passed"}`);
process.exit(fails ? 1 : 0);
