"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authedFetch } from "@/lib/client";
import { closeEscrow } from "@/lib/evm-client";
import { Fiat } from "@/components/Fiat";
import { WalletPanel } from "@/components/WalletPanel";
import { fmtUsd, txUrl } from "@/lib/aevum";
import { BRAND } from "@/lib/brand";

export default function Wallet() {
  const [w, setW] = useState<any>(null);
  const [rmsg, setRmsg] = useState("");
  const dirty = useRef(false); // true once the person has typed, so the 5-second refresh never overwrites their input
  const [addr, setAddr] = useState(""); const [msg, setMsg] = useState(""); const [prov, setProv] = useState("");
  const [nowS, setNowS] = useState(Math.floor(Date.now() / 1000)); // ticks every second for the hold countdown
  const [toast, setToast] = useState(""); const seen = useRef<Record<string, string> | null>(null);
  const [fund, setFund] = useState<Record<string, any>>({});
  useEffect(() => { const t = setInterval(() => setNowS(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t); }, []);
  const load = () => authedFetch("/api/wallet").then((x) => {
    setW(x); if (!dirty.current) setAddr(x.address);
    // a "+$N received" toast when a payout flips to paid while the page is open
    const prev = seen.current, next: Record<string, string> = {};
    for (const p of x.payouts) { next[p.id] = p.status; if (prev && prev[p.id] && prev[p.id] !== "paid" && p.status === "paid") { setToast(`+${fmtUsd(p.micro)} received · ${p.title}`); setTimeout(() => setToast(""), 6000); } }
    seen.current = next;
  });
  async function checkFunding(id: string) { setFund((f) => ({ ...f, [id]: "loading" })); try { const r = await authedFetch(`/api/tasks/${id}/funding`); setFund((f) => ({ ...f, [id]: r })); } catch (e: any) { setFund((f) => ({ ...f, [id]: { error: e.message } })); } }
  useEffect(() => { load().catch((e) => setMsg(e.message)); const t = setInterval(() => load().catch(() => {}), 5000); return () => clearInterval(t); }, []);

  async function save() { setMsg("Checking address…"); try { const r = await authedFetch("/api/wallet", { body: { address: addr } }); setMsg(r.retried ? `Saved ✓ ${r.retried} held payment(s) will be retried.` : "Saved ✓"); dirty.current = false; load(); } catch (e: any) { setMsg(e.message); } }
  async function useWalletAddress(a: string) { try { await authedFetch("/api/wallet", { body: { address: a } }); setMsg("Payout address set ✓"); dirty.current = false; setAddr(a); load(); } catch (e: any) { setMsg(e.message); } }
  async function closeTask(id: string) {
    if (!confirm("Close this task? Workers can no longer answer it. Payments already owed to workers are still paid, and the rest of the budget returns to your wallet.")) return;
    setRmsg("Confirm in your wallet…");
    try {
      const tx = await closeEscrow(id);
      setRmsg("Closing the escrow on Aevum…");
      const r = await authedFetch(`/api/tasks/${id}/close`, { body: { tx } });
      setRmsg(`Task closed ✓ The unused budget is back in your wallet.${r.dropped ? ` ${r.dropped} answer(s) approved in the last moments could not be paid.` : ""} ${txUrl(tx)}`); load();
    } catch (e: any) { setRmsg(e.message); }
  }
  async function resumeTask(id: string) { setRmsg("Checking the escrow…"); try { const r = await authedFetch(`/api/tasks/${id}/resume`, { body: {} }); setRmsg(`Task resumed ✓${r.available !== null ? ` Escrow budget left: ${fmtUsd(r.available)}.` : ""}${r.retried ? ` ${r.retried} failed payment(s) are being retried.` : ""}`); load(); } catch (e: any) { setRmsg(e.message); } }
  async function download(id: string, format: string) {
    const r = await authedFetch(`/api/export/${id}?format=${format}&attest=1`, { raw: true }) as Response;
    const ev = r.headers.get("x-nostr-event"), chainTx = r.headers.get("x-aevum-tx");
    setProv(`Dataset sha256 ${r.headers.get("x-dataset-sha256")}${chainTx ? ` · anchored on QDay Aevum in ${txUrl(chainTx)}` : ""}${ev ? ` · signed Nostr event ${ev}` : ""}`);
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = `dataset-${id.slice(0, 8)}.${format === "csv" ? "csv" : format === "zip" ? "zip" : "jsonl"}`; a.click();
  }
  useEffect(() => { if (w && location.hash === "#payaddr") document.getElementById("payaddr")?.focus(); }, [!!w]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!w) return <p className="muted">{msg || "Loading…"}</p>;
  const waiting = w.payouts.filter((p: any) => p.status === "pending").reduce((n: number, p: any) => n + p.micro, 0);
  const addressFailed = w.payouts.some((p: any) => p.status === "failed");
  const steps = [
    { done: !!w.address, title: "Choose where to get paid", why: "Create a wallet on this phone in one tap, or paste the address of one you have.", action: <button className="btn sm" onClick={() => document.getElementById("wallet-panel")?.scrollIntoView({ behavior: "smooth", block: "center" })}>Set up payouts</button> },
    { done: w.reputation.accepted > 0 || w.total > 0, title: "Complete your first task", why: "Answer one item and get paid.", action: <Link className="btn sm secondary" href="/tasks">Find a task</Link> },
    { done: w.reputation.qualified.length > 0, title: "Pass a language test", why: "Unlocks verification work and better-paid tasks (optional).", action: <Link className="btn sm secondary" href="/qualify">Take a test</Link> },
  ];
  const left = steps.filter((x) => !x.done), doneCount = steps.length - left.length;
  return (
    <div className="narrow">
      {toast && <div className="toast-ok" role="status">{toast}</div>}
      <div className="tag">Wallet</div>
      <h1>Your wallet</h1>
      {!w.address && waiting > 0 && <div className="banner"><div><b>{fmtUsd(waiting)} is waiting for you.</b> Set up where to get paid below and it is sent automatically.</div></div>}
      {addressFailed && <div className="banner"><div><b>A payout could not be sent.</b> Check your wallet address below, then press Save. Failed payments are retried.</div></div>}
      <section className="sum">
        <div className="lab">Earned on {BRAND}</div>
        <div className="amt">{fmtUsd(w.total)}<small>tUSD8</small></div>
        <div className="ngn"><Fiat micro={w.total} className="" /></div>
        <div className="meter" aria-hidden><i style={{ width: `${Math.min(100, (w.today / w.cap) * 100)}%` }} /></div>
        <div className="cap">{fmtUsd(w.today)} of {fmtUsd(w.cap)} paid in the last 24 hours (daily limit)</div>
      </section>

      {left.length > 0 && !(w.myTasks.length > 0 && w.reputation.attempts === 0) && ( // requesters who only post tasks do not need the worker checklist
        <section className="card todo">
          <div className="sec-head"><h3>Get started</h3><span className="muted small">{doneCount} of {steps.length} done</span></div>
          {steps.map((x, i) => (
            <div key={i} className={`todo-row ${x.done ? "done" : ""}`}>
              <span className="todo-ic" aria-hidden>{x.done ? "✓" : i + 1}</span>
              <div className="todo-tx"><b>{x.title}</b><span>{x.done ? "Done" : x.why}</span></div>
              {!x.done && left[0] === x ? x.action : null}
            </div>))}
        </section>
      )}

      <WalletPanel savedAddress={w.address} onUseAddress={useWalletAddress} onChange={() => load().catch(() => {})} />

      <section className="card">
        <div className="sec-head"><h3>Or paste an address</h3>{w.address && !dirty.current ? <span className="pill paid">✓ address saved</span> : null}</div>
        <label htmlFor="payaddr">Wallet address on QDay Aevum (any EVM wallet: MetaMask, Rabby, Trust…)</label>
        <input id="payaddr" value={addr} onChange={(e) => { dirty.current = true; setAddr(e.target.value); }} placeholder="0x…" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <div className="row" style={{ gap: 8 }}><button className="btn inline" onClick={save}>Save address</button></div>
        {msg && <p className="muted small" style={{ margin: "6px 0 0" }}>{msg}</p>}
        <p className="hint" style={{ margin: "8px 0 0" }}>New to wallets? <Link href="/wallet-help">See how it works</Link>.</p>
      </section>

      <section className="card">
        <div className="sec-head"><h3>Your reputation</h3><span className="pill">{w.reputation.level}</span></div>
        <div className="row" style={{ marginTop: 6 }}>
          <div className="stat sm"><b>{w.reputation.score}</b><span>Score</span></div>
          <div className="stat sm"><b>{w.reputation.acceptRate}%</b><span>Accepted ({w.reputation.accepted}/{w.reputation.attempts})</span></div>
          {w.reputation.hiddenCheckRate !== null && <div className="stat sm"><b>{w.reputation.hiddenCheckRate}%</b><span>Quality checks</span></div>}
        </div>
        <p className="hint" style={{ margin: "10px 0 0" }}>{w.reputation.level === "Trusted" ? "Top level reached." : `Next level: ${w.reputation.level === "New" ? "5 accepted answers or verifications with a score of 30+" : "20 accepted with a score of 70+"}.`} {w.reputation.qualified.length ? <>Qualified: {w.reputation.qualified.join(", ")}.</> : <><Link href="/qualify">Take a language test</Link> to unlock verification work.</>} It follows your account key.</p>
      </section>
      <h2>Payouts</h2>
      {w.payouts.length === 0 && <p className="muted">Nothing yet. <Link href="/tasks">Find a task</Link></p>}
      {w.payouts.length > 0 && <div className="card list">{w.payouts.map((p: any) => {
        const left = (p.release_at || 0) - nowS;
        // pending: approved here, not yet on chain · onchain: held in the escrow until the hold ends · paid: in the worker's wallet
        const st = p.status === "paid" ? { step: 3, label: "Paid into your wallet", tone: "paid" }
          : p.status === "onchain" ? (left > 0 ? { step: 2, label: `Locked for you in the escrow · released in ${left}s`, tone: "" } : { step: 2, label: "Releasing…", tone: "" })
          : p.status === "pending" ? (!w.address ? { step: 1, label: "Waiting for you to choose where to get paid", tone: "bad" } : { step: 1, label: "Approved · recording it on chain…", tone: "" })
          : { step: 0, label: p.status === "withheld" ? "Withheld (quality check failed)" : "Failed", tone: "bad" };
        return (
          <div key={p.id} className="item" style={{ display: "block" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <b style={{ color: "var(--navy)", fontWeight: 500 }}>{p.title}</b>
              <span className="mono" style={{ fontSize: 14, color: p.status === "paid" ? "var(--ink)" : "var(--ash)" }}>{p.status === "paid" ? "+" : ""}{fmtUsd(p.micro)}</span>
            </div>
            <div className={`trk ${st.tone}`}>{[1, 2, 3].map((n) => <i key={n} className={st.step >= n ? "on" : ""} />)}</div>
            <div className="trk-l"><span className={st.tone === "bad" ? "err" : ""}>{st.label}</span>{p.error && <span className="err">{String(p.error).replace(/^escrow: /, "")}</span>}
              {p.tx && p.tx !== "mock" && <a className="small" href={txUrl(p.tx)} target="_blank" rel="noreferrer">See the payment on chain ↗</a>}
              {!p.tx && p.accrue_tx && <a className="small" href={txUrl(p.accrue_tx)} target="_blank" rel="noreferrer">See it locked on chain ↗</a>}</div>
          </div>);
      })}</div>}
      {w.myTasks.length > 0 && <h2>Tasks you posted</h2>}
      {prov && <p className="hint mono" style={{ wordBreak: "break-all" }}>{prov}</p>}
      {rmsg && <p className="hint">{rmsg}</p>}
      {w.myTasks.map((t: any) => (
        <div key={t.id} className="card">
          {t.status === "paused" && <div className="warn"><b>Paused.</b> {t.pause_reason}
            <button className="btn sm" onClick={() => resumeTask(t.id)}>Check the escrow and resume</button></div>}<h3><Link href={`/task/${t.id}`} style={{ textDecoration: "none" }}>{t.title}</Link></h3><div className="muted small">{t.paid} paid answers · {t.items} items{t.fund_tx ? <> · <a href={txUrl(t.fund_tx)} target="_blank" rel="noreferrer">escrow funded ↗</a></> : null}</div>
          <div style={{ margin: "10px 0 4px" }}>
            <button className="btn sm secondary" onClick={() => checkFunding(t.id)} disabled={fund[t.id] === "loading"}>{fund[t.id] === "loading" ? "Checking…" : fund[t.id] ? "Check funding again" : "Check funding"}</button>
            {fund[t.id] && fund[t.id] !== "loading" && (fund[t.id].error ? <p className="err" style={{ margin: "8px 0 0" }}>{fund[t.id].error}</p> : (() => { const f = fund[t.id]; return (
              <div className="fund">
                <div className="fund-row"><span>May still pay</span><b>{fmtUsd(f.needed)} <Fiat micro={f.needed} /></b></div>
                <div className="muted small" style={{ margin: "-2px 0 6px" }}>{fmtUsd(f.heldMicro)} owed to workers + {fmtUsd(f.remainingMicro)} for answers still to come · {fmtUsd(f.paidMicro)} paid so far</div>
                {f.simulated ? <div className="muted small">Simulated payments: nothing to fund.</div> : <>
                  <div className="fund-row"><span>Escrow on Aevum</span><b>{fmtUsd(f.escrow.available + f.escrow.held)}</b></div>
                  <div className="muted small" style={{ margin: "-2px 0 6px" }}>{fmtUsd(f.escrow.available)} unearned budget + {fmtUsd(f.escrow.held)} locked for workers</div>
                  {f.funded ? <span className="pill paid">✓ Funded for the whole task</span>
                    : <div className="warn" style={{ margin: "8px 0 0" }}><b>Short by about {fmtUsd(f.short)}.</b> The task pauses when the escrow cannot pay the next answer.</div>}
                </>}
              </div>); })())}
          </div>
          {t.status !== "closed" && t.fund_tx && <button className="btn sm secondary" style={{ marginBottom: 8 }} onClick={() => closeTask(t.id)}>Close task and take back unused budget</button>}
          {t.status === "closed" && <p className="muted small">Closed. Unused budget returned to your wallet.</p>}
          <div className="row">{t.kind === "speak" ? <button className="btn secondary" onClick={() => download(t.id, "zip")}>Export ZIP (audio + JSONL)</button> : t.kind === "rank" ? <button className="btn secondary" onClick={() => download(t.id, "jsonl")}>Export preferences (JSONL)</button> : <><button className="btn secondary" onClick={() => download(t.id, "jsonl")}>Export JSONL</button><button className="btn secondary" onClick={() => download(t.id, "csv")}>Export CSV</button></>}</div></div>
      ))}
    </div>
  );
}
