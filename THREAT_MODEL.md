# Threat model

Lugha moves small amounts of money between strangers and stores voice recordings, so its design starts from what an attacker could gain and what the app refuses to hold. This document lists what is protected, who might attack it, and what the code does about each threat. **Status** is stated honestly: ✅ implemented and tested, 🟡 partial, ⬜ not done.

## What we protect

| Asset | Why it matters |
|---|---|
| Requester budgets | The tUSD8 locked in the `TaskEscrow` contract for each task. |
| The operator key | The server's key. It records accepted answers on chain and pays gas. |
| Worker accounts and earnings | An account is a private key, and so is a wallet created on the device. Whoever holds the key holds the earnings. |
| Voice recordings | Personal data. |
| Dataset integrity | Requesters pay for correct data. |
| Server secrets | `OPERATOR_PRIVATE_KEY`, `APP_SECRET`, `GEMINI_API_KEY`, database URL. |

## Design principles

1. **The app never holds money.** A task's budget sits in an escrow contract on QDay Aevum, not in a wallet we control. The contract, not the server, decides who can be paid and how much.
2. **The server's power is bounded by code.** The operator key can only record payments at the task's fixed rates, to workers, within the budget and a per-worker cap. It cannot pay itself or the requester, and cannot move the budget anywhere else.
3. **Workers do not depend on us to get paid.** Once a payment's hold is over, anyone can release it. If the app disappears, a worker can still collect.
4. **Distrust every input.** Everything a client sends is validated, bounded and treated as data, including text that is passed to the LLM.
5. **Fail closed.** If grading, the chain or secret handling fails, nothing is paid and nothing is silently downgraded.

## Trust boundaries

```
Browser  ──signed requests──►  App server  ──►  Postgres
   │                               │
   │ signs one EIP-3009            ├──► Gemini API (grading)
   │ message (requester)           ├──► Nostr relays (public events)
   ▼                               ▼
QDay Aevum testnet ◄── operator key: createTaskWithAuthorization, accrue, withhold, release, anchorDataset
   TaskEscrow (holds budgets)  ·  tUSD8 (token)
```

The contract is the only party trusted with money. The app server is trusted to grade answers, but the contract limits what a compromised server could do.

## Threats and mitigations

### Money

| Threat | Mitigation | Status |
|---|---|---|
| The app is breached and the operator key is stolen | The thief can only do what the operator can: record payments at the task's fixed rates to worker addresses, within the budget and the per-worker cap. They cannot pay the operator or the requester, change a rate, or withdraw a budget. Requesters can pause or close their task from their own wallet at any time, which refunds everything not yet earned. The realistic worst case is a task's budget paid out to addresses the thief controls, posing as workers. | ✅ contract tests |
| A relayer (or the app) changes the terms of a requester's signed funding | The requester signs an EIP-3009 transfer whose nonce is the hash of every task term: escrow, task id, requester, operator, rates, cap and hold. Any change gives a different nonce, and tUSD8 rejects the signature. | ✅ contract and end-to-end tests |
| The browser signs a budget that does not match the task | The server recomputes the budget from the task and refuses a mismatch before calling the chain; the token would also reject it. | ✅ end-to-end test |
| A database failure leaves money locked for a task the app does not know | The task is written to the database first (`funding`), then funded on chain, then opened. If funding fails, the rows are deleted. If the final update fails, the task is still recorded, and the requester can close the escrow from their wallet. | ✅ found and fixed by the end-to-end test |
| Double payment (retries, replays, races) | A unique database constraint on (item, worker), an atomic claim flag before each on-chain batch, and on chain a claim id derived from (task, item, worker) that can never be recorded twice, even after it was withheld. | ✅ contract tests |
| A worker fails a hidden check after being paid | Payments are held on chain for the task's hold time. During it, the operator (or the requester) withholds the payments of a worker who failed a check, and the money returns to the budget. After the hold, the payment is owed and can no longer be withheld. | ✅ contract tests |
| Overspending a task | The contract refuses any payment beyond the budget. A budget error pauses the task so workers are not sent to unpaid work. | ✅ contract tests |
| The escrow's accounting drifts | A fuzz test checks, over 256 random runs, that the escrow always holds exactly the unearned budget plus the payments on hold. | ✅ fuzz test |
| A worker's on-device wallet is lost | The key is generated and kept in the browser. The wallet page asks the worker to back it up and explains why; the key can be imported into MetaMask or Rabby. | 🟡 a cleared browser without a backup loses the earnings |
| Payout stuck if the process dies after claiming a batch | A batch claimed but not sent stays flagged and needs manual review. | 🟡 |

### Identity and access

| Threat | Mitigation | Status |
|---|---|---|
| Impersonating a user | Every API call carries a signed Nostr event (NIP-98 style) bound to URL path, method and a hash of the body, valid for 60 seconds. Tampered bodies, wrong URLs and stale requests are refused. | ✅ tested |
| Replay of a captured request inside the 60-second window | Most replays are harmless because actions are idempotent or already recorded, but there is no nonce store. | 🟡 |
| Account key stolen from the browser | The key lives in `localStorage`. A content security policy blocks third-party scripts and framing (inline scripts are still allowed, because the framework needs them). A browser extension signer (NIP-07) is supported so the key never touches the page. | 🟡 |
| Losing the key means losing the account | A backup banner appears until the worker saves a key file. There is no recovery by design (no email, no passwords to leak). | 🟡 |
| Closing someone else's task | Closing the escrow needs the requester's wallet (the contract checks it), and the app only marks a task closed after reading the closed state on chain. | ✅ end-to-end test |
| Reading someone else's recordings | A recording is only served to its speaker, the task's requester, or a reviewer who was assigned that clip. | ✅ |
| Exporting someone else's dataset | Only the requester can export, and hidden check items never leave the server. | ✅ tested |

### Data quality and fraud

| Threat | Mitigation | Status |
|---|---|---|
| Bots and copy-pasting for pay | Minimum answer time, per-key rate limit, repeated-answer detection, copied-prompt detection, and a payout hold. | ✅ |
| Gaming the grader | Hidden check items with known answers are mixed in. Failing one withholds that worker's payouts on chain. | ✅ tested |
| Prompt injection through an answer or a recording | Answers are wrapped as data and the model is told never to follow instructions inside them. The model only decides pass or fail on a fixed rubric. | ✅ spot-tested with a live model |
| The LLM is wrong about Yoruba, Hausa or Pidgin | The model is a spam and coherence filter, not a translation judge, and is told to pass spelling and tone-mark variants. Correctness comes from several workers answering and from peers verifying recordings. | ✅ by design |
| Grader outage or overload | Falls back to a faster model. If every model fails, the answer is **not** paid. | ✅ observed live |
| Fake verification (reviewers guessing) | The reviewer never sees the expected sentence, must wait most of the clip's length before answering, and is only paid when their transcript matches. | ✅ tested |
| **One person with many keys** | Per-key limits are cheap to bypass, because keys are free. The real bound on losses is the task's budget, enforced by the contract. New accounts start at the lowest level and need a language test for gated tasks. | 🟡 no IP or device limits |

### Application

| Threat | Mitigation | Status |
|---|---|---|
| Oversized or malformed input | Reward, item counts, title, instructions, prompts, replies, wallet addresses and request bodies all have limits. Languages are checked against a list. Audio must be a WAV of limited size and length. | ✅ tested |
| SQL injection | Every query is parameterised. | ✅ |
| Script injection and clickjacking | Content security policy, `X-Frame-Options`, `nosniff`, referrer and permissions policies, HSTS. React escapes output. | ✅ |
| Secrets in logs | Our code logs only error messages. It never logs keys, addresses or answers. | ✅ |
| Secrets in the repository | `.env.local` is ignored. Only `.env.example` with empty values is committed. Deployment keys go through Foundry's encrypted keystore. | ✅ |
| Denial of service on public endpoints | There is no IP-level rate limiting; only the answer and review endpoints are limited per key. Rely on the host's edge protection. | ⬜ rely on the host's edge protection |

### Privacy

| Threat | Mitigation | Status |
|---|---|---|
| Workers are identifiable | Accounts are anonymous keys, with no email, phone or name. Payout addresses are public on chain, as on any blockchain, but are not linked to a name. | ✅ |
| Recordings used without consent | A consent screen must be accepted before recording. Each task states its data license, and the license is written into the export. | ✅ |
| Withdrawal | Accepted recordings are paid for and become part of the dataset, so they cannot be withdrawn. The consent screen says so before the worker records. Some data protection laws give people withdrawal rights, so a legal review is needed before real use. | 🟡 |

## Not covered (known limits)

- The contract has not been audited. It is small, has no admin key and no upgrade path, and is covered by unit, attack and fuzz tests.
- Testnet only: tUSD8 has no cash value. A mainnet launch needs QDay's native stablecoin and an audit.
- No audit of the third-party libraries beyond using widely used ones (`viem`, `nostr-tools`, `pg`, OpenZeppelin).
- Exchange rates come from a free public API and are only for display.
- Not penetration tested.

## Reporting

Please open an issue on the repository without including secrets, or contact the maintainers privately for anything sensitive.
