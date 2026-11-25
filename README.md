# Lugha

**Teach AI your language and get paid in digital dollars.** Lugha is a mobile-first app where people earn tUSD8, a dollar stablecoin on QDay Aevum, for small language tasks in Nigerian Pidgin, Yoruba, Hausa and English. Requesters lock each task's budget in an escrow contract with a single signature and no gas. In return they get a quality-checked dataset whose fingerprint is anchored on chain.

Built for the **Aevum Builder Challenge #1** (QDay × DoraHacks). Every payment, budget and dataset proof settles on **QDay Aevum testnet** (chain 44005).

- Contract: `TaskEscrow` at [`0x326ee3c2aB3ed4c52708aA5Ac786f5966adbAC9E`](https://explorer-test.qday.info/address/0x326ee3c2aB3ed4c52708aA5Ac786f5966adbAC9E) on QDay Aevum testnet, source verified
- Live app: `<URL after deployment>`
- How it can be attacked and what it does about it: [THREAT_MODEL.md](THREAT_MODEL.md)
- Who it helps: [docs/IMPACT.md](docs/IMPACT.md)

## Live on Aevum testnet

The full money path has run on the live testnet, driven through the app's API by `scripts/chain-e2e.mjs` (24 checks, all passing, rewards of $0.02):

| Call | What happened | Transaction |
|---|---|---|
| `createTaskWithAuthorization` | a requester funds a task with one signature; the app relays it and pays the gas | [0x87f067f6…](https://explorer-test.qday.info/tx/0x87f067f68a2eeb3b5a02be6f7a4d3f7df4428e85b3c1184ec33b4ea6478c549c) |
| `accrue` | three accepted answers are recorded and locked for the hold | [0xcac153a9…](https://explorer-test.qday.info/tx/0xcac153a98428683d8b9f10bf6ceeec2926f9b6d6b7c388ca719f17cdebbaa4ab) |
| `release` | after the hold, the tUSD8 goes to the worker's wallet | [0x1373c46e…](https://explorer-test.qday.info/tx/0x1373c46e604b591fb6dad66a78d5a49fa16ef885c21b4e4d1bf3556339d4cf13) |
| `anchorDataset` | the export's SHA-256 is stored in the escrow | [0x69d8a546…](https://explorer-test.qday.info/tx/0x69d8a546a89fc75e9dc5b620670009022399f77826c686f54cab478b64c8ebed) |
| `close` | the requester closes the task and gets the unused budget back | [0xb3a55ced…](https://explorer-test.qday.info/tx/0xb3a55ced6d447dba105657f48bf579c8aafe23566c3a5413b757c3154aa59148) |

After the run the escrow held exactly zero: every cent was either paid to the worker or refunded.

## The problem

Two gaps meet in Africa:
- **Online work is hard to get paid for.** Millions of young people have a smartphone and spare time, but no bank account, card or way to receive international payments, so online work paid in dollars is hard to reach.
- **AI works poorly in African languages.** Research describes Nigerian Pidgin, Yoruba and Hausa as low-resource, and community-built datasets are the main remedy.

Paying many people small amounts is where both gaps meet, and it has three requirements:
- the worker must receive money without a bank;
- the amount must keep its value;
- the requester must be able to trust that the money exists and will only pay for accepted work.

A stablecoin on a chain with sub-cent fees covers the first two, and an escrow contract covers the third.

## What it does

**Workers** create an account in one tap: a key kept on their device, with no email or phone number. Then they:
- translate, read sentences aloud, rank AI replies, or verify other people's recordings;
- get paid to a wallet created on their phone in one tap (or any EVM address), with no gas needed to receive;
- see each payment move from *approved* to *locked for you in the escrow* to *paid*, with explorer links and the value in their local currency (14 currencies).

**Requesters** post a task, then:
- sign **one EIP-3009 message** in their wallet, which moves the whole budget into the task's escrow. The app relays it, so they pay no gas;
- download the dataset (JSONL, CSV, or a ZIP with audio) with agreement labels, and its SHA-256 is stored in the escrow on chain;
- close the task from their wallet at any time to take back every cent nobody has earned.

Launch languages are English, Nigerian Pidgin, Yoruba and Hausa. The code is language-agnostic, with 40+ African languages built in that switch on with one setting, and right-to-left scripts are handled.

## How the money works

```
Requester wallet ──(signs EIP-3009, no gas)──► app relays ──► TaskEscrow.createTaskWithAuthorization
                                                                │ budget locked
Worker answers ──► grader + hidden checks + peers ──► accepted
                                                                │
                              operator: accrue(task, answers) ──► payment owed, held N seconds
                              hidden check failed during hold? ──► withhold → back to the budget
                              hold over: release(claims) ──────► tUSD8 lands in the worker's wallet
                                                                │  (anyone can call release)
Requester: export dataset ──► anchorDataset(task, sha256)       │
Requester wallet: close(task) ─────────────────────────────────► unearned budget refunded
```

[`contracts/src/TaskEscrow.sol`](contracts/src/TaskEscrow.sol) has no admin key and no upgrade path:

| Who | Can | Cannot |
|---|---|---|
| Requester | fund (gasless), top up, pause, withhold during a hold, close and get a refund | take back money already owed to a worker |
| Operator (our server) | record accepted answers, withhold during a hold, anchor a dataset hash | pay any amount other than the task's two fixed rates, pay itself or the requester, exceed the budget or the per-worker cap, move the budget |
| Anyone | release a payment once its hold is over | release early, or to anyone but the worker in the claim |

Two details make it safe to relay:
- **The signed terms can't be changed.** The requester's signature commits to every term of the task: escrow, task, requester, operator, rates, cap and hold. A relayer that changes any of them gets a different EIP-3009 nonce, and the token refuses the transfer.
- **The same answer can't be paid twice.** A claim id is `keccak(task, item, worker)`, so the same answer can never be paid twice, even after a retry or a withhold.

## Quality

| Task type | What the worker does | How quality is checked |
|---|---|---|
| Translation / labelling | Types an answer | Spam filter, hidden check items, agreement between workers |
| Voice recording | Reads a sentence aloud (16 kHz WAV) | Audio filter, plus a second qualified listener who types what they hear |
| Preference ranking | Picks the better of two AI replies | Hidden gold items and vote agreement |

The LLM (Gemini) is a spam and coherence filter, not a translation authority. Correctness comes from people: several workers per item, listeners who verify recordings, and hidden check items. A worker caught by a check during the hold has their payment withheld **on chain**. Workers have levels and can pass language tests to unlock gated work.

## Architecture

| Layer | What | Where |
|---|---|---|
| Contract | `TaskEscrow` (Solidity 0.8.24, Shanghai EVM, OpenZeppelin `SafeERC20`) | `contracts/` |
| Chain access | viem; operator transactions are sent one at a time | `src/lib/chain.ts` |
| Shared chain logic | Aevum chain, task and item ids, the funding nonce and EIP-712 message (used by browser and server) | `src/lib/aevum.ts` |
| Browser wallet | connect and switch to Aevum, sign the funding, close a task, on-device payout wallet | `src/lib/evm-client.ts` |
| Payout engine | pending → `accrue` → `withhold` / `release`, batched per task, run lazily from API routes (no cron) | `src/lib/payout.ts` |
| App | Next.js 15, Postgres, Nostr-signed API requests (NIP-98 style), Gemini grader | `src/app`, `src/lib` |

## Run it

### One command, simulated payments (no chain, no wallet)
```bash
docker compose up --build        # then open http://localhost:3000
npm test                         # unit tests, then the end-to-end suite against the running app
```

### Real payments on Aevum testnet
1. Use the deployed escrow above (`ESCROW_ADDRESS=0x326ee3c2aB3ed4c52708aA5Ac786f5966adbAC9E`), or deploy your own with a test wallet kept in Foundry's encrypted keystore:
   ```bash
   cd contracts && forge install            # or: git submodule update --init --recursive
   cast wallet import aevum-deployer --interactive
   forge script script/Deploy.s.sol --rpc-url aevum --account aevum-deployer --broadcast
   ```
2. Set `MOCK_PAYMENTS=0`, `ESCROW_ADDRESS` and `OPERATOR_PRIVATE_KEY` in `.env.local` (see [.env.example](.env.example)). The operator key must be a fresh wallet holding a little tQDAY for gas.
3. `npm install && npm run dev`. Requesters need tUSD8 on Aevum (QDay faucet), and workers need nothing.

## Tests

| Suite | What it covers |
|---|---|
| `npm run test:contracts` | 18 Foundry tests: the full flow, gasless funding, and every attack (relayer changing the signed terms, operator paying itself, double pay, overspend, worker cap, strangers withholding or closing), plus a fuzz test that the escrow always holds exactly what it owes |
| `npm run test:unit` | 73 checks: the funding nonce covers every term, the EIP-712 domain, dollar formatting, the SSRF guard, encryption, text matching, languages |
| `npm run test:e2e` | the whole app with simulated payments: auth, anti-abuse, grading, ranking, voice, qualification, payouts, exports, provenance |
| `scripts/chain-e2e.mjs` | the money path against a **local fork of Aevum testnet with the real tUSD8**, or the live testnet (`AEVUM_RPC=https://rpc-test.qday.info REWARD=20000`). It drives the app's API like a requester and a worker, then checks every result on chain: funding without gas, payments locked then released into the worker's wallet, the dataset hash stored in the contract, refunds on close. 24 checks |

## How this project started

The language-data app (tasks, grading, peer review, qualification, voice, exports) began as **Sats-for-Data**, built by the same team from 17 November 2026, during this challenge's build period. For Aevum, we rebuilt the whole money layer:
- the `TaskEscrow` contract and its tests;
- gasless funding through EIP-3009;
- on-chain holds, withholds and releases;
- a wallet created on the worker's phone;
- dataset hashes anchored on chain;
- refunds when a task closes;
- dollar amounts in tUSD8 everywhere, with local-currency display.

None of the earlier payment code remains.

## Known limits

- Testnet only, and the contract is not audited.
- The grader can be wrong, so peer agreement matters.
- Many keys can still extract small amounts, bounded by each task's budget.
- Accepted voice recordings cannot be withdrawn, which the consent screen says plainly; seek legal review before real use.
- A worker who clears their browser without backing up the on-device wallet loses what it holds.

## Credits

See [NOTICE.md](NOTICE.md) and [contracts/NOTICE.md](contracts/NOTICE.md). The Solidity setup, the `MockUSD8` test token, the EIP-3009 signing helper and the deploy script pattern come from the [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (MIT, PQA Labs). MIT licensed.
