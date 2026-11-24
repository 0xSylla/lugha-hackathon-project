"use client";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { authedFetch } from "@/lib/client";
import { Fiat } from "@/components/Fiat";
import { createDeviceWallet, deviceWallet, exportDeviceWallet } from "@/lib/evm-client";
import { addressUrl, fmtUsd } from "@/lib/aevum";

type Live = { address: string | null; balance: number | null; simulated?: boolean };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Where a worker gets paid. One tap creates a wallet on this device (the key never leaves it, like the sign-in key);
// the balance is read from QDay Aevum, so this app never needs, or holds, a key that can spend the worker's money.
export function WalletPanel({ savedAddress, onUseAddress, onChange }: { savedAddress: string; onUseAddress: (a: string) => void | Promise<void>; onChange?: () => void }) {
  const [device, setDevice] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);
  const [qr, setQr] = useState(""); const [copied, setCopied] = useState(false);
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => { setDevice(deviceWallet()); }, []);
  const refresh = useCallback(async () => {
    setLoading(true); setErr("");
    try { setLive(await authedFetch("/api/wallet/live")); } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (savedAddress) void refresh(); }, [savedAddress, refresh]);

  async function create() {
    setErr("");
    try { const a = createDeviceWallet(); setDevice(a); await onUseAddress(a); onChange?.(); } catch (e: any) { setErr(e.message); }
  }
  async function showQr() { if (savedAddress) setQr(qr ? "" : await QRCode.toDataURL(savedAddress, { margin: 1, width: 220 })); }
  function backup() {
    if (key) { setKey(null); return; }
    if (!confirm("Your wallet's private key will be shown. Anyone who sees it can take your money. Show it only to copy it into a wallet app such as MetaMask or Rabby.")) return;
    setKey(exportDeviceWallet());
  }

  const onDevice = !!device && !!savedAddress && device.toLowerCase() === savedAddress.toLowerCase();

  if (!savedAddress) return (
    <section className="card wp-compact" id="wallet-panel">
      <div><h3 style={{ marginBottom: 2 }}>Get paid in digital dollars <span className="pill">recommended</span></h3>
        <p className="muted small" style={{ margin: 0 }}>Create a wallet on this phone in one tap: no bank, no card, no email. You are paid in tUSD8, a dollar stablecoin on QDay Aevum.</p>
        {err && <p className="err">{err}</p>}</div>
      <button className="btn sm" onClick={create}>{device ? "Use my wallet" : "Create wallet"}</button>
    </section>
  );

  return (
    <section className="card wp" id="wallet-panel">
      <div className="wp-head">
        <div><div className="label">{onDevice ? "Wallet on this device" : "Your payout wallet"} · <a href={addressUrl(savedAddress)} target="_blank" rel="noreferrer" className="mono">{short(savedAddress)}</a></div>
          <div className="wp-bal">{live?.balance != null ? fmtUsd(live.balance) : live?.simulated ? "—" : "…"} <span>tUSD8</span></div>
          {live?.balance != null && <Fiat micro={live.balance} />}
          {live?.simulated && <p className="muted small" style={{ margin: 0 }}>Payments are simulated on this server.</p>}</div>
        <div className="wp-actions">
          <button className="btn sm secondary" onClick={() => void refresh()} disabled={loading}>{loading ? "Updating…" : "Refresh"}</button>
          <button className="btn sm secondary" onClick={showQr}>{qr ? "Hide" : "Receive"}</button>
        </div>
      </div>
      <div style={{ margin: "8px 0 4px" }}>
        <span className="pill paid">✓ payouts are paid into this wallet</span>
        <span className="pill paid" title="This app only reads your balance">✓ we can never spend from it</span>
      </div>
      {err && <p className="err">{err}</p>}
      {qr && <div className="wp-inv">
        <img src={qr} alt="Your wallet address as a QR code" width={180} height={180} />
        <code className="wp-code">{savedAddress}</code>
        <button className="btn sm secondary" onClick={() => { void navigator.clipboard?.writeText(savedAddress); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied ✓" : "Copy address"}</button>
      </div>}
      {onDevice && <>
        <p className="hint" style={{ margin: "10px 0 0" }}>This wallet lives only in this browser. <b>Back it up</b> before you clear your browser or change phones, or what you earned is lost.</p>
        <button className="linkbtn" onClick={backup}>{key ? "Hide private key" : "Back up this wallet"}</button>
        {key && <code className="wp-code" style={{ wordBreak: "break-all" }}>{key}</code>}
      </>}
      {!onDevice && device && <button className="linkbtn" style={{ marginTop: 12 }} onClick={() => onUseAddress(device)}>Get paid to the wallet on this device ({short(device)}) instead</button>}
      {!device && <button className="linkbtn" style={{ marginTop: 12 }} onClick={create}>Create a wallet on this device instead</button>}
    </section>
  );
}
