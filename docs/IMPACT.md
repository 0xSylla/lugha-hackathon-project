# Usefulness and local impact

## The problem

Two gaps meet here, and one stable digital dollar can close both.

1. **People with phones but no way to be paid.** Many young Nigerians have a smartphone and spare time but no bank account, card or route to receive international payments, so online work paid in dollars is out of reach for them.
2. **AI that works poorly in local languages.** Published research describes Nigerian Pidgin, Yoruba and Hausa as low-resource: there is far less machine-readable text and speech than for English, and community-built datasets are the main remedy. See the NaijaNLP survey, the NaijaSenti dataset (about 30,000 annotated tweets across Hausa, Igbo, Yoruba and Pidgin) and the MasakhaNER work listed under Sources.

A dollar stablecoin on a chain with sub-cent fees (tUSD8 on QDay Aevum) can pay very small amounts to anyone with a phone, keeps its value from one day to the next, and needs no bank. Card-based and bank-based payouts cannot do that economically. An escrow contract adds what a requester needs: proof that the money exists, and that it only pays for accepted work.

## Who it is for

### Primary user: the worker

An **illustrative persona** (not an interviewee): a university student or recent graduate in a Nigerian city, fluent in Pidgin and either Yoruba or Hausa, with a mid-range Android phone, patchy mobile data and no dollar account.

| | Today | With Lugha |
|---|---|---|
| Earning from phone skills | Needs a bank or dollar account and an identity check, and fees are high | Create an account in one tap, with no email or phone number |
| A spare 10 minutes | Nothing that pays for that little time | Answer a handful of short items on one screen each |
| Getting paid | Days, minimums, fees | Accepted answers are paid in seconds to a wallet address |
| Knowing where you stand | Opaque | Every rejection shows its reason, and levels unlock better-paid tasks |

### Secondary user: the requester

Groups that need local-language data: research labs, NGOs and public-interest projects, and companies localising a chatbot or voice product. They post a task, fund it from their own capped wallet link, and download a dataset with agreement labels and a provenance hash.

> **Validation status:** we have not interviewed any workers or requesters. The persona and the requester segment are hypotheses. The first validation step is described under "How we would measure it".

## What changes for them

- **A worker** gets a way to turn language knowledge into small, immediate income, and a track record (reputation by account key) that unlocks higher-value work.
- **The language communities** get datasets built by their own speakers, with speaker consent and a stated license.
- **Requesters** get data whose quality is checked by several independent speakers and by hidden gold items, not by a model that may be weak in these languages.

## Reach: an illustrative model

These are **assumptions to test, not measurements**.

Exchange rate used: about ₦1,370 per US dollar (a public rate feed, late November 2026), so **$0.20 ≈ ₦274**. Rewards are in dollars, so their naira value only moves with the naira itself.

Assumptions: a worker completes **20 accepted items per week**; the reward is **$0.20 per item**; each item is answered by **2 workers**.

| Active workers | Accepted answers per week | Paid to workers per week | Sentence pairs with 2-way agreement per month |
|---|---|---|---|
| 50 (a campus pilot) | 1,000 | $200, about ₦274,000 | about 2,000 |
| 500 (several campuses) | 10,000 | $2,000, about ₦2.74 million | about 20,000 |

- **A worker's income:** 20 items × $0.20 = **$4 (about ₦5,480) per week** of supplemental income. That is modest by design: a flexible top-up, not a salary.
- **A requester's cost:** one verified sentence pair needs two answers, so 2 × $0.20 = **$0.40 (about ₦548)**, or $400 per 1,000 pairs, before any quality bonus.

## How we would measure it

A four-week pilot with one campus group, tracking:

| Metric | Why it matters |
|---|---|
| Weekly active workers | Real reach |
| Share of new workers who set up a payout wallet and receive a first payout | **The biggest risk:** the wallet step and cashing out. This is the number that decides whether the idea works. |
| Median time from first visit to first payment received | Friction |
| Acceptance rate and share of consensus items | Data quality |
| Payout success rate | Reliability of the payment path |
| Items completed per worker per week | Checks the 20-items assumption |
| Requesters who come back for a second task | Whether anyone wants the data |

## Risks to the claims above

- **The wallet barrier.** Getting paid takes one tap: a wallet is created on the worker's phone and needs no gas. The harder step is turning tUSD8 into naira, which depends on QDay's mainnet stablecoin and local off-ramps; that is the largest drop-off risk. A worker who clears their browser without backing up the wallet also loses what it holds.
- **Demand.** Whether requesters will pay for this data at these prices is untested.
- **Small earnings.** At about ₦5,480 per week, motivation will depend on tasks being quick and enjoyable and on cash-out being easy.
- **Testnet.** Payments today are in tUSD8 on QDay's testnet, which has no cash value. Real earnings wait for QDay's mainnet (planned for early 2027).

## Sources

- NaijaNLP: a survey of Nigerian low-resource languages, <https://arxiv.org/html/2502.19784v2>
- NaijaSenti: a Nigerian Twitter sentiment corpus, <https://www.lsv.uni-saarland.de/wp-content/uploads/2022/06/lrec2022_NaijaSenti.pdf>
- MasakhaNER: named entity recognition for African languages, <https://arxiv.org/pdf/2103.11811v1.pdf>
