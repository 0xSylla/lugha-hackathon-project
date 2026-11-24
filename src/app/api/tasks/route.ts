import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import { all, run, tx } from "@/lib/db";
import { cooldownSecs } from "@/lib/payout";
import { createFundedTask, mockPayments, operatorAddress, type SignedFunding } from "@/lib/chain";
import { taskBudget, type Terms } from "@/lib/aevum";
import { withAuth } from "@/lib/auth";
import { publishEvent, checkTaskEvent } from "@/lib/nostr";
import { LICENSES } from "@/lib/consent";
import { allowedLang, enabledLanguages, hasTest } from "@/lib/languages";
import { taskLang } from "@/lib/reputation";

export const runtime = "nodejs";

export async function GET() {
  const rows = await all(`
    SELECT t.id,t.title,t.kind,t.src_lang,t.dst_lang,t.reward_micro,t.created_at,t.nostr_event_id,t.answers_per_item,t.min_level,t.require_qual,t.review_micro,t.funder,t.fund_tx,
      (SELECT COUNT(*) FROM items i WHERE i.task_id=t.id AND i.is_check=0) AS item_count,
      (SELECT COUNT(*) FROM payouts p WHERE p.task_id=t.id AND p.status='paid' AND p.item_id NOT LIKE 'rev:%') AS paid_count
    FROM tasks t WHERE t.status='open' ORDER BY t.created_at DESC`);
  return Response.json(rows);
}

type In = { prompt?: string; a?: string; b?: string; labels?: string[]; answer?: string };

export async function POST(req: Request) {
  return withAuth(req, async (pk, b) => {
    const kind = ["translate", "classify", "label", "speak", "rank"].includes(b.kind) ? b.kind : "translate";
    const rank = kind === "rank";
    const okItem = (i: In) => i?.prompt?.trim() && (!rank || (i.a?.trim() && i.b?.trim()));
    const items: In[] = (b.items || []).filter(okItem);
    const checks: In[] = (b.checks || []).filter((c: In) => okItem(c) && c.answer?.trim() && (!rank || ["A", "B"].includes(c.answer.trim().toUpperCase())));
    const id = String(b.id || "");
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Missing task id");
    checkTaskEvent(b.event, pk, id); // the REQUESTER signs the public task event
    if (!b.title?.trim() || items.length < 1 || items.length > 200) throw new Error("Need a title and 1-200 valid items");
    // Bounded inputs: everything below is stored and shown to other people.
    if (b.title.length > 120) throw new Error("Title is too long (max 120 characters)");
    if (String(b.instructions || "").length > 1000) throw new Error("Instructions are too long (max 1000 characters)");
    // Any language is allowed (it is just a name), but it must look like one.
    const src = allowedLang(b.src ?? "English"), dst = allowedLang(b.dst ?? "English");
    if (!src || !dst) throw new Error("Unsupported language. Available now: " + enabledLanguages().map((l) => l.name).join(", "));
    if (b.requireQual && !hasTest(taskLang({ kind, src_lang: src, dst_lang: dst }))) throw new Error(`There is no qualification test for ${taskLang({ kind, src_lang: src, dst_lang: dst })} yet. Publish without the language check.`);
    if ([...items, ...checks].some((i) => (i.prompt || "").length > 500 || (i.a || "").length > 1000 || (i.b || "").length > 1000 || (i.answer || "").length > 500)) throw new Error("An item is too long (prompts max 500 characters, replies max 1000)");
    // Rewards are in micro tUSD8 (6 decimals): 10_000 = $0.01, 10_000_000 = $10.
    const reward = Math.floor(Number(b.reward));
    if (!(reward >= 10_000 && reward <= 10_000_000)) throw new Error("Reward must be between $0.01 and $10 per answer");
    const minLevel = Math.min(Math.max(Math.floor(Number(b.minLevel) || 0), 0), 2);
    const answersPerItem = Math.min(Math.max(Math.floor(Number(b.answersPerItem)) || 1, 1), 5);
    // Voice tasks also pay a peer to verify each clip (30% of the item reward).
    const reviewMicro = kind === "speak" ? Math.max(10_000, Math.round(reward * 0.3)) : null;

    // The budget is everything the task can cost, locked in the escrow up front, so a worker is never sent
    // to work that cannot be paid. The server recomputes it: if the browser signed anything else, the token
    // rejects the signature.
    const itemCount = items.length + checks.length;
    const slots = itemCount * answersPerItem;
    const budget = taskBudget(slots, reward, reviewMicro);
    let funding: { f: SignedFunding; terms: Terms } | null = null;
    if (b.funding === "demo") {
      if (!mockPayments()) throw new Error("Simulated funding only works when MOCK_PAYMENTS=1");
    } else {
      const f = b.funding as SignedFunding;
      if (!f || String(f.budget) !== String(budget)) throw new Error("The signed budget does not match this task. Reload the page and sign again.");
      funding = {
        f,
        terms: {
          operator: operatorAddress(),
          reward: BigInt(reward),
          reviewReward: BigInt(reviewMicro ?? 0),
          maxPerWorker: BigInt(itemCount * reward + slots * (reviewMicro ?? 0)),
          holdSecs: BigInt(cooldownSecs()),
        },
      };
    }
    // Hidden check items are shuffled in with real ones and look identical to workers.
    const all2 = [
      ...items.map((i) => ({ ...i, check: 0, answer: null as string | null })),
      ...checks.map((c) => ({ ...c, check: 1, answer: rank ? c.answer!.trim().toUpperCase() : c.answer!.trim() })),
    ].sort(() => Math.random() - 0.5);
    await tx(async (t) => {
      await t.run(`INSERT INTO tasks (id,requester,title,kind,src_lang,dst_lang,instructions,reward_micro,funder,fund_tx,created_at,answers_per_item,min_level,require_qual,review_micro,license,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, pk, b.title.trim(), kind, src, dst,
        (b.instructions || "").trim(), reward, funding ? funding.f.requester.toLowerCase() : "demo", null, Math.floor(Date.now() / 1000), answersPerItem,
        minLevel, b.requireQual ? 1 : 0, reviewMicro, (LICENSES as readonly string[]).includes(b.license) ? b.license : LICENSES[0], funding ? "funding" : "open");
      for (const [n, i] of all2.entries()) {
        await t.run("INSERT INTO items (id,task_id,position,prompt,is_check,known_answer,labels,payload) VALUES (?,?,?,?,?,?,?,?)",
          randomUUID(), id, n, i.prompt!.trim(), i.check, i.answer, i.labels ? JSON.stringify(i.labels) : null, rank ? JSON.stringify({ a: i.a!.trim(), b: i.b!.trim() }) : null);
      }
    });
    // The task is recorded first (status 'funding'), then funded on chain, then opened. A database failure can
    // therefore never leave money locked for a task the app does not know about.
    let fundTx: string | null = null;
    if (funding) {
      try {
        fundTx = (await createFundedTask(id, funding.terms, funding.f)).hash;
      } catch (e: any) {
        await tx(async (t) => { await t.run("DELETE FROM items WHERE task_id=?", id); await t.run("DELETE FROM tasks WHERE id=?", id); });
        const m = String(e?.shortMessage || e?.message || e);
        if (/balance|exceeds/i.test(m)) throw new Error("Your wallet does not hold enough tUSD8 for this budget.");
        if (/signature|authoriz/i.test(m)) throw new Error("The wallet signature was not accepted. Sign again.");
        throw new Error("Funding the task on Aevum failed: " + m.slice(0, 160));
      }
      await run("UPDATE tasks SET status='open', fund_tx=? WHERE id=?", fundTx, id);
    }
    const ev = await publishEvent(b.event);
    await run("UPDATE tasks SET nostr_event_id=? WHERE id=?", b.event.id, id);
    return { id, nostrEventId: b.event.id, published: !!ev, fundTx, budget };
  });
}
