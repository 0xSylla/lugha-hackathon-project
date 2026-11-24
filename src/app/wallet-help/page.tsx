import Link from "next/link";
import { BRAND } from "@/lib/brand";

export default function WalletHelp() {
  return (
    <div className="narrow">
      <div className="tag">Help</div>
      <h1>How you get paid</h1>
      <p className="lead">You are paid in tUSD8, a digital dollar on the QDay Aevum network. One tUSD8 is meant to be worth one US dollar, and your Wallet page also shows it in your own currency.</p>
      <section className="card">
        <h3>The easiest way: a wallet on this phone</h3>
        <ol className="steps">
          <li><span>Open your <Link href="/wallet">Wallet</Link> page and press <b>Create wallet</b>. It is made on your phone in one tap: no email, no phone number, no bank.</span></li>
          <li><span>Your payouts go there automatically. You never need gas or any other coin to receive them.</span></li>
          <li><span>Press <b>Back up this wallet</b> and keep the key somewhere safe. If you clear your browser or lose your phone without it, your earnings are lost.</span></li>
        </ol>
      </section>
      <section className="card">
        <h3>Already have a wallet?</h3>
        <p className="muted small">Any EVM wallet works, for example MetaMask, Rabby or Trust Wallet. Add the QDay Aevum Testnet network, copy your address (it starts with 0x) and paste it on your Wallet page. You can also import the key of the wallet made on this phone into one of these apps to move what you earned.</p>
      </section>
      <section className="card">
        <h3>Good to know</h3>
        <ul className="lp-list">
          <li>This runs on QDay's testnet: tUSD8 is a test dollar for now, with no cash value.</li>
          <li>Back up your {BRAND} sign-in key too, because it is your account and your reputation.</li>
          <li>Start small: do one task and watch the payment arrive before doing more.</li>
        </ul>
      </section>
    </div>
  );
}
