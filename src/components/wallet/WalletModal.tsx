"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccount, useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { motion } from "motion/react";
import { CHAIN, CHAIN_ID, short, explorerAddress, LINKS } from "@/lib/config";
import { useSession, useVerifyBySignature, useVerifyByTransaction, useLogout } from "@/lib/useSession";
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
  const step = !isConnected || !address ? 1 : chainId !== CHAIN_ID ? 1 : session ? 3 : 2;

  return (
    <>
      <StepIndicator step={step} />
      {step === 1 && (!isConnected || !address ? <Connect /> : <WrongChain />)}
      {step >= 2 && address && (
        <Verify address={address} connectorName={connector?.name} onClose={onClose} />
      )}
    </>
  );
}

/* ── indicator: connect → verify → done ─────────────────────── */
function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["connect", "verify"];
  return (
    <div className="mb-6 flex items-center gap-2 text-[11.5px] uppercase tracking-[0.14em] text-mute">
      {labels.map((label, i) => {
        const idx = (i + 1) as 1 | 2;
        const active = step === idx;
        const done = step > idx;
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold transition-colors ${
                done ? "bg-ok/25 text-ok" : active ? "bg-simp/25 text-simp-2" : "bg-white/5 text-mute"
              }`}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Icon name="check" className="h-3 w-3" /> : idx}
            </span>
            <span className={done || active ? "text-text" : ""}>{label}</span>
            {i < labels.length - 1 && (
              <span className="mx-1 h-px w-8 bg-line" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── step 1: pick a wallet ─────────────────────────────────── */
function Connect() {
  const connectors = useConnectors();
  const { connectAsync, isPending, variables, error } = useConnect();
  const [err, setErr] = useState<string | null>(null);

  const list = connectors.filter(
    (c) => !(c.id === "injected" && connectors.some((o) => o.type === "injected" && o.id !== "injected")),
  );

  return (
    <>
      <Header title="connect wallet" sub="monad mainnet only. no approvals, ever." />
      <div className="mt-6 space-y-2.5">
        {list.length === 0 && (
          <p className="text-sm text-dim">
            no wallet found in this browser. install a wallet extension, or set{" "}
            <span className="mono">NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID</span> to enable walletconnect.
          </p>
        )}
        {list.map((c) => (
          <button
            key={c.uid}
            disabled={isPending}
            onClick={async () => {
              setErr(null);
              try {
                await connectAsync({ connector: c, chainId: CHAIN_ID });
              } catch (e) {
                setErr((e as Error).message.split("\n")[0]);
              }
            }}
            className="glass glass-hover flex w-full items-center gap-3 px-4 py-3.5 text-left"
            aria-label={`connect with ${c.name}`}
          >
            {c.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.icon} alt="" className="h-7 w-7 rounded-md" />
            ) : (
              <span className="grid h-7 w-7 place-items-center rounded-md bg-simp/20 text-simp-2">
                <Icon name="wallet" className="h-4 w-4" />
              </span>
            )}
            <span className="flex-1 text-sm font-medium">{c.name}</span>
            {isPending && variables?.connector === c ? (
              <Icon name="spinner" className="h-4 w-4 text-simp-2" />
            ) : (
              <span className="text-xs text-mute">{c.type === "walletConnect" ? "qr / mobile" : "extension"}</span>
            )}
          </button>
        ))}
      </div>
      {(err || error) && <p className="mt-3 text-xs text-bad">{err ?? error?.message.split("\n")[0]}</p>}
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
        <button className="btn btn-primary flex-1" disabled={isPending} onClick={() => switchChainAsync({ chainId: CHAIN_ID })}>
          {isPending ? <Icon name="spinner" /> : "switch network"}
        </button>
        <button className="btn btn-ghost" onClick={() => disconnect()} aria-label="disconnect wallet">
          disconnect
        </button>
      </div>
      {error && <p className="mt-3 text-xs text-bad">{error.message.split("\n")[0]}</p>}
    </>
  );
}

/* ── step 2/3: verify + verified ───────────────────────────── */
function Verify({ address, connectorName, onClose }: { address: `0x${string}`; connectorName?: string; onClose: () => void }) {
  const { session, isHolder, isLoading } = useSession();
  const sig = useVerifyBySignature();
  const tx = useVerifyByTransaction();
  const logout = useLogout();
  const { disconnect } = useDisconnect();
  const [mode, setMode] = useState<"sig" | "tx">("sig");
  const busy = sig.isPending || tx.isPending;
  const err = (sig.error ?? tx.error)?.message.split("\n")[0];

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
    toast.ok(
      isHolder ? "verified · holder" : "verified",
      isHolder ? `holding ${session.balance} simp` : "wallet holds 0 simp — grab one on opensea",
    );
  }, [session, isHolder]);

  return (
    <>
      <Header
        title={session ? "verified" : "verify it's you"}
        sub={
          <span className="flex items-center gap-2">
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
          <motion.div
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 20, mass: 0.5 }}
            className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ok/15 text-ok shadow-[0_0_0_1px_rgba(126,226,179,.35),0_18px_50px_-16px_rgba(126,226,179,.5)]"
            aria-hidden
          >
            <motion.svg
              viewBox="0 0 24 24"
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
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

          <div className="flex items-center gap-3">
            <span className={`pill ${isHolder ? "pill-ok" : "pill-warn"}`}>
              <Icon name={isHolder ? "check" : "warn"} className="h-3 w-3" />
              {isHolder ? `holder · ${session.balance} simp` : "not a holder"}
            </span>
            <span className="pill">{session.method === "siwe" ? "signature" : "self-tx"}</span>
          </div>
          {!isHolder && (
            <p className="text-sm text-dim">
              this wallet holds no simp cult nft. grab one on{" "}
              <a className="link" href={LINKS.opensea} target="_blank" rel="noreferrer">opensea</a>{" "}
              or connect a different wallet.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Link href="/dao" onClick={onClose} className="btn btn-primary">dao</Link>
            <Link href="/verify" onClick={onClose} className="btn btn-ghost">telegram</Link>
          </div>
          <div className="flex justify-between text-xs text-mute">
            <button className="hover:text-white" onClick={() => logout.mutate()}>sign out</button>
            <button className="hover:text-white" onClick={() => { logout.mutate(); disconnect(); }}>disconnect</button>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <div className="segment w-full">
            <button className="flex-1" data-active={mode === "sig"} onClick={() => setMode("sig")}>sign message (free)</button>
            <button className="flex-1" data-active={mode === "tx"} onClick={() => setMode("tx")}>self-transaction</button>
          </div>

          {mode === "sig" ? (
            <p className="text-sm leading-relaxed text-dim">
              you&apos;ll sign a plain-text message (sign-in with ethereum). it&apos;s not a transaction: no gas, and a
              signature <em>cannot</em> move or approve any asset. the message names this domain, your address, the
              monad chain id and a one-time code that expires in 5 minutes.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-dim">
              for wallets that can&apos;t sign messages: send <span className="text-text">0 MON from your address to your own
              address</span> with a one-time code in the data field. only gas is spent. we check the mined transaction —
              nothing else touches your wallet.
            </p>
          )}

          <button
            className="btn btn-primary w-full"
            disabled={busy || isLoading}
            onClick={() => (mode === "sig" ? sig.mutate() : tx.mutate())}
          >
            {busy ? <Icon name="spinner" /> : mode === "sig" ? "sign & verify" : "send self-tx & verify"}
          </button>
          {tx.isPending && <p className="text-center text-xs text-mute">waiting for confirmation on monad…</p>}
          {err && <p className="text-xs text-bad">{err}</p>}
          <button className="w-full text-center text-xs text-mute hover:text-white" onClick={() => disconnect()}>
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
      <h2 className="t-h2 text-[24px]">{title}</h2>
      <div className="mt-2 text-[13px] text-dim">{sub}</div>
    </div>
  );
}
function SecurityNote() {
  return (
    <p className="mt-6 flex items-start gap-2.5 text-[12px] leading-relaxed text-mute">
      <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-simp-2" />
      <span>
        we never request token approvals. if a wallet prompt ever asks for <em>setApprovalForAll</em> or a
        different chain, reject it — it isn&apos;t us. run a simulation extension like pocket universe for an extra
        layer. <Link href="/security" className="link">how we keep this safe →</Link>
      </span>
    </p>
  );
}
