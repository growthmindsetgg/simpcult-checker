import type { Metadata } from "next";
import { LINKS, NFT_ADDRESS, DAO_ADDRESS, DAO_DEPLOYED, explorerAddress } from "@/lib/config";
import { Icon } from "@/components/Icon";
import { Reveal } from "@/components/motion";

export const metadata: Metadata = { title: "security" };

export default function SecurityPage() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 pb-32 pt-36">
      <Reveal>
      <p className="t-eyebrow mb-4 flex items-center gap-2">
        <Icon name="shield" className="h-3.5 w-3.5" /> wallet safety
      </p>
      <h1 className="t-h1 text-[clamp(34px,5vw,52px)]">how connecting here stays safe</h1>
      <p className="t-lead mt-5">
        short version: this site can only ever ask your wallet for three things — a signature to prove it&apos;s you,
        a dao propose/vote transaction, and (optionally) a 0-MON transaction to yourself. nothing else. if a prompt
        ever looks different, reject it.
      </p>
      </Reveal>

      <div className="mt-14 space-y-6 text-[14.5px] leading-relaxed">
        <Block title="what we never ask for">
          <ul className="list-disc space-y-1.5 pl-5 text-dim">
            <li><b className="text-text">no token approvals</b> — never <span className="mono">approve</span>, never <span className="mono">setApprovalForAll</span>, never <span className="mono">permit</span>.</li>
            <li><b className="text-text">no chain switching</b> away from monad (chain id 143). the site is configured with one chain only.</li>
            <li><b className="text-text">no blind signing</b> — you sign a plain-text sign-in-with-ethereum message that names this domain, your address and a one-time code. no <span className="mono">eth_sign</span>, no opaque hex.</li>
            <li><b className="text-text">no third-party scripts</b> on the page — wallet logic runs from this domain, with a strict content-security-policy.</li>
          </ul>
        </Block>

        <Block title="verification, two ways">
          <p className="text-dim">
            <b className="text-text">signature (default)</b> — sign-in with ethereum (eip-4361). free, instant. the server checks the signature
            (eoa, smart wallets via erc-1271/6492), the domain, the chain id and that the nonce is ours, unused and under 5 minutes old.
          </p>
          <p className="mt-3 text-dim">
            <b className="text-text">self-transaction (fallback)</b> — some hardware, exchange-hosted or multisig wallets can&apos;t sign messages.
            send 0 MON from your address to <em>your own</em> address with the one-time code in the data field. we verify the mined transaction:
            from == to, value 0, calldata matches, block within 30 minutes. only gas is spent and the funds never leave your wallet.
          </p>
        </Block>

        <Block title="the only contracts we talk to">
          <div className="space-y-2">
            <Addr label="simp cult nft (erc-721)" address={NFT_ADDRESS} />
            {DAO_DEPLOYED ? <Addr label="simp dao (governor)" address={DAO_ADDRESS} /> : <p className="text-xs text-mute">dao contract: not deployed yet</p>}
          </div>
          <p className="mt-3 text-dim">
            before confirming a dao transaction, your wallet shows the target address. it must be one of these. the dao contract is open source in
            the repo (<span className="mono">contracts/SimpDAO.sol</span>) and verified on the explorer after deployment.
          </p>
        </Block>

        <Block title="pocket universe & simulation extensions">
          <p className="text-dim">
            we recommend running a transaction-simulation extension such as{" "}
            <a className="link" href={LINKS.pocketUniverse} target="_blank" rel="noreferrer">pocket universe</a>. it sits between the site and your wallet,
            simulates each request and warns you before anything malicious gets signed — an independent check that doesn&apos;t rely on trusting us.
          </p>
          <p className="mt-3 text-dim">
            heads-up on what it is and isn&apos;t: pocket universe is a browser extension — there is no api a website can &quot;integrate&quot;, and it is
            you who installs it, not us. as of our last check its supported-chain list did not include monad yet, so on monad it may not simulate
            every call. that&apos;s why the site itself is designed to be safe even without it: no approvals, one chain, readable signatures, and
            every transaction target published above. wallets with built-in simulation (rabby, etc.) work the same way.
          </p>
        </Block>

        <Block title="on our side">
          <ul className="list-disc space-y-1.5 pl-5 text-dim">
            <li>nonces are single-use with a 5-minute ttl and are consumed atomically.</li>
            <li>sessions are httpOnly, sameSite cookies signed with hmac-sha256; nothing sensitive is stored in localStorage.</li>
            <li>holder status is re-read from chain on every sensitive action (dao, telegram gate), never trusted from the cookie alone.</li>
            <li>telegram invite links are single-use and expire in 10 minutes; membership is re-checked hourly and non-holders are removed.</li>
          </ul>
        </Block>
      </div>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <div className="glass p-7">
        <h2 className="t-h3 mb-4 text-[18px]">{title}</h2>
        {children}
      </div>
    </Reveal>
  );
}
function Addr({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-black/30 px-3 py-2">
      <span className="text-xs text-dim">{label}</span>
      <a className="mono link" href={explorerAddress(address)} target="_blank" rel="noreferrer">{address}</a>
    </div>
  );
}
