"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, signNostrEvent } from "@/lib/client";
import { LangPick } from "@/components/LangPick";
import { cleanLang, hasTest, dirFor } from "@/lib/languages";
import { chainConfig, hasBrowserWallet, signFunding, type ChainConfig } from "@/lib/evm-client";
import { fmtUsd, MICRO, taskBudget } from "@/lib/aevum";
import { Fiat } from "@/components/Fiat";

const KINDS: [string, string][] = [
  ["translate", "Translation (worker types an answer)"],
  ["speak", "Voice recording (worker reads sentences aloud)"],
  ["rank", "Preference ranking (worker picks the better reply)"],
];
type Row = { prompt: string; a: string; b: string; answer: string };
const blank = (answer = ""): Row => ({ prompt: "", a: "", b: "", answer });

export default function Post() {
  const r = useRouter();
  const [f, setF] = useState({ title: "", kind: "translate", src: "English", dst: "Nigerian Pidgin", instructions: "", reward: "0.20", answersPerItem: 2, minLevel: 0, requireQual: false, license: "Research use only" });
  const [items, setItems] = useState<Row[]>([blank(), blank(), blank()]);
  const [checks, setChecks] = useState<Row[]>([]);
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(""); const [chain, setChain] = useState<ChainConfig | null>(null);
  useEffect(() => { chainConfig().then(setChain).catch(() => setErr("Could not load the payment settings. Reload the page.")); }, []);
  const set = (k: string, v: any) => setF((o) => ({ ...o, [k]: v }));
  const speak = f.kind === "speak", rank = f.kind === "rank";
  const lang = cleanLang(f.dst), testable = f.kind === "translate" && f.dst === "English" ? hasTest(f.src) : !!lang && hasTest(f.dst);

  const srcLang = speak || rank ? f.dst : f.src;
  const upd = (list: Row[], setList: (r: Row[]) => void, i: number, k: keyof Row, v: string) => setList(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const del = (list: Row[], setList: (r: Row[]) => void, i: number, min = 0) => list.length > min && setList(list.filter((_, j) => j !== i));
  const filled = (x: Row) => x.prompt.trim() && (!rank || (x.a.trim() && x.b.trim()));
  const good = items.filter(filled), goodChecks = checks.filter((c) => filled(c) && (rank ? ["A", "B"].includes(c.answer) : c.answer.trim()));

  function addPasted() {
    const rows = paste.split("\n").map((s) => s.trim()).filter(Boolean).map((p) => ({ ...blank(), prompt: p }));
    if (!rows.length) return;
    setItems([...items.filter((x) => x.prompt.trim() || x.a.trim()), ...rows]); setPaste("");
  }

  // Same arithmetic as the server: every answer slot at the reward, plus a peer check per slot for voice tasks.
  const n = good.length;
  const rewardMicro = Math.round(Number(f.reward || 0) * MICRO);
  const reviewMicro = speak ? Math.max(10_000, Math.round(rewardMicro * 0.3)) : 0;
  const apl = Math.min(Math.max(Math.floor(Number(f.answersPerItem)) || 1, 1), 5);
  const itemCount = n + (speak ? 0 : goodChecks.length);
  const slots = itemCount * apl;
  const budget = taskBudget(slots, rewardMicro, reviewMicro || null);
  const rewardOk = rewardMicro >= 10_000 && rewardMicro <= 10_000_000;

  async function submit() {
    setBusy("Preparing…"); setErr("");
    try {
      // The requester signs the public task announcement with their own Nostr key (provenance).
      const taskId = crypto.randomUUID();
      const event = await signNostrEvent({
        kind: 30078, created_at: Math.floor(Date.now() / 1000), content: JSON.stringify({ title: f.title }),
        tags: [["d", `lugha:${taskId}`], ["t", "lugha"], ["lang", f.src, f.dst], ["reward_usd", String(rewardMicro / MICRO)], ["items", String(good.length)]],
      });
      // Then their wallet signs the budget into the escrow on Aevum. No gas: the app relays it.
      let funding: unknown = "demo";
      if (!chain?.mock) {
        setBusy("Sign in your wallet…");
        funding = await signFunding(taskId, budget, { reward: rewardMicro, review: reviewMicro, maxPerWorker: itemCount * rewardMicro + slots * reviewMicro });
        setBusy("Locking the budget on Aevum…");
      }
      const strip = (x: Row) => (rank ? { prompt: x.prompt, a: x.a, b: x.b } : { prompt: x.prompt });
      const res = await authedFetch("/api/tasks", { body: { ...f, reward: rewardMicro, answersPerItem: apl, requireQual: f.requireQual && testable, src: speak || rank ? f.dst : f.src, id: taskId, event, funding,
        items: good.map(strip), checks: speak ? [] : goodChecks.map((c) => ({ ...strip(c), answer: c.answer })) } });
      r.push(`/task/${res.id}`);
    } catch (e: any) { setErr(e.message); setBusy(""); }
  }

  const editor = (list: Row[], setList: (r: Row[]) => void, gold: boolean) => list.map((x, i) => (
    <div key={i} className="irow">
      <div className="irow-head"><span className="label">{gold ? "Check" : "Item"} {i + 1}</span>
        <button type="button" className="x" aria-label="Remove" onClick={() => del(list, setList, i, gold ? 0 : 1)}>×</button></div>
      <input dir={dirFor(srcLang, x.prompt)} value={x.prompt} onChange={(e) => upd(list, setList, i, "prompt", e.target.value)}
        placeholder={rank ? "The user's message, e.g. “How far? You don chop?”" : speak ? "Sentence to read aloud" : `Sentence in ${f.src}`} />
      {rank && <div className="row">
        <div><input dir={dirFor(f.dst, x.a)} value={x.a} onChange={(e) => upd(list, setList, i, "a", e.target.value)} placeholder="Reply A" /></div>
        <div><input dir={dirFor(f.dst, x.b)} value={x.b} onChange={(e) => upd(list, setList, i, "b", e.target.value)} placeholder="Reply B" /></div>
      </div>}
      {gold && (rank
        ? <select value={x.answer} onChange={(e) => upd(list, setList, i, "answer", e.target.value)}><option value="">Which reply is clearly better?</option><option value="A">Reply A is better</option><option value="B">Reply B is better</option></select>
        : <input dir={dirFor(f.dst, x.answer)} value={x.answer} onChange={(e) => upd(list, setList, i, "answer", e.target.value)} placeholder={`Known good answer in ${f.dst}`} />)}
    </div>
  ));

  return (
    <div className="narrow">
      <div className="tag">Requester</div>
      <h1>Post a task</h1>
      <p className="lead">Fund paid language work in digital dollars (tUSD8 on QDay Aevum). The budget is locked in an escrow contract, not with us: workers are paid from it, and you take back what is not used.</p>

      <section className="card">
        <h3>Basics</h3>
        <label>Task type</label>
        <select value={f.kind} onChange={(e) => set("kind", e.target.value)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label>Title</label><input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder={rank ? `Which ${f.dst || "local-language"} reply is better?` : `Translate greetings to ${f.dst || "your language"}`} />
        <div className="row">
          {f.kind === "translate" && <div><label>From</label><LangPick value={f.src} onChange={(v) => set("src", v)} /></div>}
          <div><label>{f.kind === "translate" ? "To" : "Language"}</label><LangPick value={f.dst} onChange={(v) => set("dst", v)} /></div>
        </div>
        <label>Instructions for workers (optional)</label>
        <textarea value={f.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder={rank ? "Pick the reply that is more natural, correct and helpful." : "Anything workers should know"} />
      </section>

      <section className="card">
        <div className="sec-head"><h3>{speak ? "Sentences to read aloud" : rank ? "Prompts and replies" : "Items to translate"} <span className="muted small">({n})</span></h3></div>
        {editor(items, setItems, false)}
        <div className="row" style={{ marginTop: 4 }}>
          <button type="button" className="btn secondary" onClick={() => setItems([...items, blank()])}>+ Add item</button>
        </div>
        {!rank && <details><summary>Paste a list instead</summary>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="One per line" />
          <button type="button" className="btn secondary" onClick={addPasted} disabled={!paste.trim()}>Add these as items</button>
        </details>}
      </section>

      {!speak && (
        <section className="card">
          <div className="sec-head"><h3>Quality checks <span className="muted small">(optional, {goodChecks.length})</span></h3></div>
          <p className="hint" style={{ margin: "0 0 12px" }}>Items where you already know the right answer. They are mixed in and look identical to workers. Anyone who fails them is not paid.</p>
          {editor(checks, setChecks, true)}
          <button type="button" className="btn secondary" onClick={() => setChecks([...checks, blank()])}>+ Add check item</button>
        </section>
      )}

      <section className="card">
        <h3>Payment and access</h3>
        <div className="row">
          <div><label>Dollars per answer</label><input type="number" min={0.01} max={10} step={0.01} value={f.reward} onChange={(e) => set("reward", e.target.value)} /></div>
          <div><label>Workers per item</label><input type="number" min={1} max={5} value={f.answersPerItem} onChange={(e) => set("answersPerItem", e.target.value)} /></div>
        </div>
        {speak && <><label>Data license (shown to speakers, included in the export)</label>
          <select value={f.license} onChange={(e) => set("license", e.target.value)}>{["Research use only", "Open (CC BY 4.0)", "Commercial use permitted", "Exclusive to the requester"].map((l) => <option key={l}>{l}</option>)}</select></>}
        <div className="row">
          <div><label>Who can work on it</label>
            <select value={f.minLevel} onChange={(e) => set("minLevel", Number(e.target.value))}><option value={0}>Anyone</option><option value={1}>Regular level and above</option><option value={2}>Trusted level only</option></select></div>
          <div><label>Language check</label>
            <select value={f.requireQual ? "1" : "0"} onChange={(e) => set("requireQual", e.target.value === "1")}><option value="0">No test needed</option><option value="1" disabled={!testable}>{testable ? `Must pass the ${f.dst} test` : `No ${f.dst || "language"} test yet`}</option></select>
            {!testable && <p className="hint" style={{ margin: "-8px 0 8px" }}>Tests exist for the languages offered here. If one has none, use quality checks and more workers per item.</p>}</div>
        </div>
        <div className="fund-box">
          <div className="sec-head"><h3 style={{ margin: 0 }}>Budget: {fmtUsd(budget)} <span className="muted small">tUSD8</span></h3><Fiat micro={budget} /></div>
          <p className="hint">{itemCount} {itemCount === 1 ? "item" : "items"} × {apl} {apl === 1 ? "worker" : "workers"} × {fmtUsd(rewardMicro)}{speak ? ` + ${fmtUsd(reviewMicro)} per clip for a peer to verify it` : ""}. This is the most the task can cost.</p>
          {chain?.mock
            ? <p className="hint">Payments are simulated on this server: no wallet needed.</p>
            : <>
              <p className="hint">When you publish, your wallet asks you to sign <b>one message</b> that moves {fmtUsd(budget)} tUSD8 into the task's escrow on QDay Aevum. You pay no gas. Each accepted answer is held for {Math.round((chain?.holdSecs ?? 60) / 60) || 1} min, so a worker caught by a quality check during that time is not paid, then it goes straight to the worker. Close the task any time to get back what nobody earned.</p>
              {!hasBrowserWallet() && <p className="hint">You need a browser wallet such as MetaMask or Rabby, holding tUSD8 on Aevum testnet (free from the QDay faucet).</p>}
            </>}
        </div>
        <p className="hint">{rank ? "With 2+ workers per item, votes are counted and each row is labeled consensus or disputed." : speak ? "Each accepted recording is also verified by a second, qualified listener who types what they hear." : "With 2+ workers per item, independent answers are compared and labeled consensus or disputed."} Your task is announced on Nostr, signed with your key.</p>
        {!rewardOk && <p className="err">Set between $0.01 and $10 per answer.</p>}
        {err && <p className="err">{err}</p>}
        <button className="btn" disabled={!!busy || !chain || !rewardOk || !f.title.trim() || !n || !lang || !cleanLang(srcLang)} onClick={submit}>{busy || (chain?.mock ? `Publish task (${n} ${n === 1 ? "item" : "items"})` : `Sign and lock ${fmtUsd(budget)}`)}</button>
      </section>
    </div>
  );
}
