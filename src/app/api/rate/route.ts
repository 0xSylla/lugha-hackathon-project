import { CURRENCIES } from "@/lib/languages";
export const runtime = "nodejs";

type Entry = { at: number; perUsd: number; source: string };
const cache = new Map<string, Entry>();
// Only Nigeria has a built-in fallback, because made-up rates for other currencies would mislead. Others show nothing when the feed is down.
const FALLBACK: Record<string, number> = { USD: 1, NGN: Number(process.env.FALLBACK_NGN_PER_USD || 1500) };

// Approximate value of one US dollar (so one tUSD8) in the worker's currency (?cur=KES), cached 1 hour.
// Falls back to a stale value so the UI never breaks.
export async function GET(req: Request) {
  const cur = (new URL(req.url).searchParams.get("cur") || "NGN").toUpperCase();
  if (!CURRENCIES.some((c) => c.code === cur)) return Response.json({ error: "Unsupported currency" }, { status: 400 });
  if (cur === "USD") return Response.json({ cur, perUsd: 1, source: "fixed" });
  const hit = cache.get(cur);
  if (hit && Date.now() - hit.at < 3_600_000) return Response.json({ cur, perUsd: hit.perUsd, source: hit.source });
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    if (j?.result !== "success") throw new Error("bad feed");
    for (const c of CURRENCIES) { const v = j.rates?.[c.code]; if (v > 0) cache.set(c.code, { at: Date.now(), perUsd: v, source: "open.er-api.com" }); }
    if (!cache.get(cur) || cache.get(cur)!.at < Date.now() - 60_000) throw new Error("no rate");
  } catch {
    const old = hit?.perUsd ?? FALLBACK[cur];
    if (!old) return Response.json({ cur, perUsd: null, source: "unavailable" });
    cache.set(cur, { at: hit ? hit.at : Date.now() - 3_000_000, perUsd: old, source: hit ? "stale" : "fallback" });
  }
  const e = cache.get(cur)!;
  return Response.json({ cur, perUsd: e.perUsd, source: e.source });
}
