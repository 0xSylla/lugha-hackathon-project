"use client";
import { useEffect, useState } from "react";
import { CURRENCIES, curByCode, guessCurrency } from "@/lib/languages";

// The worker's own currency (remembered on this device). Defaults from the browser locale, e.g. sw-KE -> KES.
const rates = new Map<string, number | null>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let current = "USD";
const notify = () => listeners.forEach((f) => f());

export function currentCurrency() { return current; }
export function setCurrency(code: string) {
  if (!curByCode(code)) return;
  current = code;
  try { localStorage.setItem("sfd_cur", code); } catch { /* private mode */ }
  notify();
}
export function initCurrency() {
  let saved: string | null = null;
  try { saved = localStorage.getItem("sfd_cur"); } catch { /* private mode */ }
  current = saved && curByCode(saved) ? saved : guessCurrency(navigator.language || "en");
  notify();
}
const load = (cur: string) => {
  if (!inflight.has(cur)) inflight.set(cur, fetch(`/api/rate?cur=${cur}`).then((r) => r.json()).then((j) => { rates.set(cur, j.perUsd > 0 ? j.perUsd : null); }).catch(() => { rates.set(cur, null); }).then(notify));
  return inflight.get(cur)!;
};

// Amounts are micro tUSD8 (1 tUSD8 = 1,000,000 = one US dollar).
export const fiatFor = (micro: number, cur = current) => { const r = rates.get(cur); return r ? (micro / 1e6) * r : null; };
export const fmtFiat = (n: number, cur = current) => {
  const sym = curByCode(cur)?.symbol ?? "";
  const dec = n === 0 ? "0" : n < 10 && cur !== "UGX" && cur !== "TZS" ? n.toFixed(n < 1 ? 2 : 1) : Math.round(n).toLocaleString();
  return sym + dec;
};

export function useCurrency() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((x) => x + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  useEffect(() => { void load(current); }, [current]);
  return current;
}

// Small approximate local-currency value next to a dollar amount (hidden when the currency is USD: it would repeat it).
export function Fiat({ micro, className }: { micro: number; className?: string }) {
  const cur = useCurrency();
  const n = fiatFor(micro, cur);
  if (n === null || cur === "USD") return null;
  return <span className={className ?? "muted small"} title="Approximate. Rates change.">≈ {fmtFiat(n, cur)}</span>;
}

export function CurrencyPicker() {
  const cur = useCurrency();
  return (
    <select className="cur-pick" aria-label="Show amounts in" value={cur} onChange={(e) => setCurrency(e.target.value)}>
      {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
    </select>
  );
}
