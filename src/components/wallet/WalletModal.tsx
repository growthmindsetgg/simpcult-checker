"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccount, useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { motion } from "motion/react";
import { CHAIN, CHAIN_ID, short, explorerAddress, LINKS } from "@/lib/config";
import { useSession, useVerifyBySignature, useVerifyByTransaction, useLogout, humanError } from "@/lib/useSession";
import { Icon } from "../Icon";
import { ModalShell } from "../motion";
import { toast } from "../Toast";

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ModalShell open={open} onClose={onClose}>
      <Body onClose={onClose} />
    </ModalShell>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const { address, isConnected, chainId, connector } = useAccount();
  const { session } = useSession();
  const [connecting, setConnecting] = useState(false);

  // verified by self-transaction with no wallet connected here ("send and set")
  if ((!isConnected || !address) && session && !connecting) {
    return (
      <>
        <StepIndicator step={3} />
        <Verify address={session.address} connectorName="no wallet connected" onClose={onClose} onConnect={() => setConnecting(true)} />
      </>
    );
  }

  const step = !isConnected || !address ? 1 : chainId !== CHAIN_ID ? 1 : session ? 3 : 2;
  return (
    <>
      <StepIndicator step={step} />
      {step === 1 && (!isConnected || !address ? <Connect onClose={onClose} /> : <WrongChain />)}
      {step >= 2 && address && (
        <Verify
          address={address}
          connectorName={connector ? connectorLabel(connector.id, connector.name, connector.type) : undefined}
          onClose={onClose}
        />
      )}
    </>
  );
}

/* "Injected" is wagmi's word, not a person's: name it for what it is */
function connectorLabel(id: string, name: string, type?: string) {
  if (type === "walletConnect") return "walletconnect";
  return id === "injected" ? "browser wallet" : name.toLowerCase();
}

/* ── indicator: connect → verify → done ─────────────────────── */
function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["connect", "verify"];
  return (
    <ol className="mb-6 flex items-center gap-2 font-serif text-[15px] italic text-mute" aria-label="progress">
      {labels.map((label, i) => {
        const idx = (i + 1) as 1 | 2;
        const active = step === idx;
        const done = step > idx;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={`mono grid h-6 w-6 place-items-center rounded-full not-italic text-[11px] font-semibold transition-colors ${
                done ? "bg-ok/15 text-ok ring-1 ring-ok/40" : active ? "bg-gold text-ink" : "text-mute ring-1 ring-line-strong"
              }`}
              aria-hidden
            >
              {done ? <Icon name="check" className="h-3 w-3" /> : idx}
            </span>
            <span className={done || active ? "text-text" : ""}>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
            {i < labels.length - 1 && <span className="mx-1 h-px w-8 bg-line-strong" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/* ── step 1: pick a wallet ─────────────────────────────────── */
const WC_MISSING = /dynamically imported module|cannot find module|ethereum-provider|is not a function/i;

function Connect({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors();
  const { connectAsync, isPending, variables } = useConnect();
  const [err, setErr] = useState<string | null>(null);

  // the generic "injected" entry only when no EIP-6963 wallet announced itself
  const injected = connectors.filter(
    (c) => c.type === "injected" && !(c.id === "injected" && connectors.some((o) => o.type === "injected" && o.id !== "injected")),
  );
  // present only when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set (src/lib/wagmi.ts)
  const wc = connectors.find((c) => c.type === "walletConnect");

  async function connect(c: (typeof connectors)[number]) {
    setErr(null);
    if (c.type === "walletConnect") {
      // the QR modal is its own dialog: close ours first so the two never fight
      // over focus, Escape or scroll lock. results come back as toasts.
      onClose();
      try {
        await connectAsync({ connector: c, chainId: CHAIN_ID });
        toast.ok("wallet connected", "sign in to finish verifying");
      } catch (e) {
        const msg = humanError(e);
        if (/cancelled|closed|rejected|request reset/i.test(msg)) return; // they shut the QR modal
        toast.bad(
          "walletconnect didn’t connect",
          WC_MISSING.test(msg) ? "it isn’t available right now. use a browser wallet, or verify by sending a transaction." : msg,
        );
      }
      return;
    }
    try {
      await connectAsync({ connector: c, chainId: CHAIN_ID });
    } catch (e) {
      setErr(humanError(e));
    }
  }

  const row =
    "glass glass-hover flex w-full items-center gap-3 px-4 py-3.5 text-left disabled:cursor-not-allowed disabled:opacity-60";
  const pendingOn = (c: (typeof connectors)[number]) => isPending && variables?.connector === c;

  return (
    <>
      <Header title="connect wallet" sub="monad mainnet only. no approvals, ever." />
      <div className="mt-6 space-y-2.5">
        {injected.length === 0 && <p className="text-sm text-dim">no browser wallet found here.</p>}
        {injected.map((c) => (
          <button key={c.uid} type="button" disabled={isPending} aria-busy={pendingOn(c)} onClick={() => connect(c)} className={row}>
            {c.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.icon} alt="" className="h-7 w-7 rounded-md" />
            ) : (
              <span className="grid h-7 w-7 place-items-center" aria-hidden>
                <Icon name="wallet" className="h-5 w-5 text-gold" />
              </span>
            )}
            <span className="flex-1 text-[15px] font-medium text-text">{connectorLabel(c.id, c.name, c.type)}</span>
            {pendingOn(c) ? (
              <Icon name="spinner" className="h-4 w-4 text-gold" />
            ) : (
              <span className="mono text-[11.5px] text-mute">extension</span>
            )}
          </button>
        ))}
        {wc && (
          <button type="button" disabled={isPending} aria-busy={pendingOn(wc)} onClick={() => connect(wc)} className={row}>
            <span className="grid h-7 w-7 place-items-center" aria-hidden>
              <Icon name="wallet" className="h-5 w-5 text-gold" />
            </span>
            <span className="flex-1">
              <span className="block text-[15px] font-medium text-text">scan with phone</span>
              <span className="block text-[12px] text-mute">walletconnect · mobile wallets / qr code</span>
            </span>
            {pendingOn(wc) ? <Icon name="spinner" className="h-4 w-4 text-gold" /> : <span className="mono text-[11.5px] text-mute">qr</span>}
          </button>
        )}
      </div>
      {err && (
        <p role="alert" className="mt-3 text-xs text-bad">
          {err}
        </p>
      )}
      <p className="mt-5 text-[13px] leading-relaxed text-dim">
        rather not connect?{" "}
        <Link href="/join?via=send" onClick={onClose} className="link">
          verify by sending a transaction
        </Link>{" "}
        from any wallet app instead.
      </p>
      <SecurityNote />
    </>
  );
}

/* ── wrong chain ───────────────────────────────────────────── */
function WrongChain() {
  const { switchChainAsync, isPending, error } = useSwitchChain();
  const { disconnect } = useDisconnect();
  return (
    <>
      <Header title="switch to monad" sub={`this site only works on ${CHAIN.name} (chain id ${CHAIN_ID}).`} />
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          className="btn btn-primary flex-1"
          disabled={isPending}
          aria-busy={isPending}
          onClick={() => switchChainAsync({ chainId: CHAIN_ID }).catch(() => {})}
        >
          {isPending ? <Icon name="spinner" /> : "switch network"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => disconnect()}>
          disconnect
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-bad">
          {humanError(error)}
        </p>
      )}
    </>
  );
}

/* ── step 2/3: verify + verified ───────────────────────────── */
function Verify({
  address,
  connectorName,
  onClose,
  onConnect,
}: {
  address: `0x${string}`;
  connectorName?: string;
  onClose: () => void;
  /** walletless session: offer to connect a wallet instead of "disconnect" */
  onConnect?: () => void;
}) {
  const { session, isHolder, isLoading } = useSession();
  const sig = useVerifyBySignature();
  const tx = useVerifyByTransaction();
  const logout = useLogout();
  const { disconnect } = useDisconnect();
  const [mode, setMode] = useState<"sig" | "tx">("sig");
  const busy = sig.isPending || tx.isPending;
  const anyErr = sig.error ?? tx.error;
  const err = anyErr ? humanError(anyErr) : null;

  // toast once per session appearance (side effect on external store — no React state)
  const toastedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!session) {
      toastedFor.current = null;
      return;
    }
    const key = `${session.address}:${session.method}`;
    if (toastedFor.current === key) return;
    toastedFor.current = key;
    toast.ok("verified", isHolder ? `holding ${session.balance} simp` : "wallet holds 0 simp");
  }, [session, isHolder]);

  return (
    <>
      <Header
        title={session ? "verified" : "verify it’s you"}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <span className="mono">{short(address)}</span>
            <a
              className="text-mute hover:text-white"
              href={explorerAddress(address)}
              target="_blank"
              rel="noreferrer"
              title="explorer"
              aria-label="view on explorer"
            >
              <Icon name="external" className="h-3.5 w-3.5" />
            </a>
            {connectorName && <span className="text-mute">· {connectorName}</span>}
          </span>
        }
      />

      {session ? (
        <div className="mt-6 space-y-5">
          {/* a brass ring, like the bezel round the machine's win lamp */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="mx-auto grid h-14 w-14 place-items-center rounded-full border-2 border-gold text-gold-hi shadow-[inset_0_0_0_4px_var(--ink-2),inset_0_0_0_5px_var(--gold-lo),0_1px_0_rgb(246_220_149/0.25)]"
            aria-hidden
          >
            <motion.svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <motion.path
                d="M5 13l4 4L19 7"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              />
            </motion.svg>
          </motion.div>

          <div className="flex flex-wrap items-center gap-3">
            <span className={`pill ${isHolder ? "pill-ok" : "pill-warn"}`}>
              {isHolder ? `holder · ${session.balance} simp` : "not a holder"}
            </span>
            <span className="pill">{session.method === "siwe" ? "signature" : "self-tx"}</span>
          </div>
          {!isHolder && (
            <p className="text-sm text-dim">
              this wallet holds no simp cult nft. grab one on{" "}
              <a className="link" href={LINKS.opensea} target="_blank" rel="noreferrer">
                opensea
              </a>{" "}
              or use a different wallet.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Link href="/portal" onClick={onClose} className="btn btn-primary">
              portal
            </Link>
            <Link href="/join" onClick={onClose} className="btn btn-ghost">
              telegram 3x
            </Link>
          </div>
          <div className="flex justify-between text-xs text-mute">
            <button type="button" className="py-2 hover:text-white" onClick={() => logout.mutate()}>
              sign out
            </button>
            {onConnect ? (
              <button type="button" className="py-2 hover:text-white" onClick={onConnect}>
                connect a wallet
              </button>
            ) : (
              <button
                type="button"
                className="py-2 hover:text-white"
                onClick={() => {
                  logout.mutate();
                  disconnect();
                }}
              >
                disconnect
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <div className="segment w-full" role="group" aria-label="how to verify">
            <button type="button" className="flex-1" data-active={mode === "sig"} aria-pressed={mode === "sig"} onClick={() => setMode("sig")}>
              sign message (free)
            </button>
            <button type="button" className="flex-1" data-active={mode === "tx"} aria-pressed={mode === "tx"} onClick={() => setMode("tx")}>
              self-transaction
            </button>
          </div>

          {mode === "sig" ? (
            <p className="text-sm leading-relaxed text-dim">
              you&rsquo;ll sign a plain-text message (sign-in with ethereum). it&rsquo;s not a transaction: no gas, and a
              signature <em>cannot</em> move or approve any asset. the message names this domain, your address, the
              monad chain id and a one-time code that expires in 5 minutes.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-dim">
              for wallets that can&rsquo;t sign messages: send <span className="text-text">0 MON from your address to your own
              address</span> with a one-time code in the data field. only gas is spent. we check the mined transaction.
              nothing else touches your wallet.
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={busy || isLoading}
            aria-busy={busy}
            onClick={() => (mode === "sig" ? sig.mutate() : tx.mutate())}
          >
            {busy ? <Icon name="spinner" /> : mode === "sig" ? "sign & verify" : "send self-tx & verify"}
          </button>
          {tx.isPending && (
            <p className="text-center text-xs text-mute" aria-live="polite">
              waiting for confirmation on monad…
            </p>
          )}
          {err && (
            <p role="alert" className="text-xs text-bad">
              {err}
            </p>
          )}
          <button type="button" className="w-full py-2 text-center text-xs text-mute hover:text-white" onClick={() => disconnect()}>
            disconnect
          </button>
          <SecurityNote />
        </div>
      )}
    </>
  );
}

/* ── bits ─────────────────────────────────────────────────── */
function Header({ title, sub }: { title: string; sub: React.ReactNode }) {
  return (
    <div>
      <h2 className="t-h2 text-[30px]">{title}</h2>
      <div className="mt-2 text-[13px] text-dim">{sub}</div>
    </div>
  );
}
function SecurityNote() {
  return (
    <p className="mt-6 flex items-start gap-2.5 text-[12px] leading-relaxed text-mute">
      <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
      <span>
        we never request token approvals. if a wallet prompt ever asks for <em>setApprovalForAll</em> or a
        different chain, reject it. it isn&rsquo;t us. run a simulation extension like pocket universe for an extra
        layer.
      </span>
    </p>
  );
}
