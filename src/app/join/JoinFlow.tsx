"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useSendTransaction, usePublicClient } from "wagmi";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { useSession, useVerifyBySignature } from "@/lib/useSession";
import { useMounted } from "@/lib/useMounted";
import { CHAIN_ID, LINKS, SITE, short } from "@/lib/config";
import { WalletButton } from "@/components/wallet/WalletButton";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/Toast";

type Challenge = { amountWei: string; amountMon: string; expiresAt: number };
const USERNAME_RE = /^[A-Za-z0-9_]{5,32}$/;

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error ?? `request failed (${r.status})`);
  return d as T;
}

export function JoinFlow() {
  const mounted = useMounted();
  const { address, isConnected } = useAccount();
  const { session, isHolder, isLoading } = useSession();

  const connected = mounted && isConnected && !!address;
  const verified = !!session && isHolder;
  const [tgDone, setTgDone] = useState(false);

  const step = !connected ? 1 : !verified ? 2 : !tgDone ? 3 : 4;

  return (
    <div className="relative mt-14">
      <div className="step-track" aria-hidden>
        <motion.span
          initial={false}
          animate={{ height: `${((step - 1) / 3) * 100}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      <div className="space-y-4">
        <StepCard n={1} title="connect your wallet" active={step === 1} done={step > 1}>
          <p className="text-sm text-dim">monad mainnet only. we never ask for approvals.</p>
          <div className="mt-3"><WalletButton /></div>
        </StepCard>

        <StepCard n={2} title="prove it's yours" active={step === 2} done={step > 2}>
          {address && (
            <ProveOwnership
              address={address as `0x${string}`}
              isHolder={isHolder}
              session={session}
              loading={isLoading}
            />
          )}
        </StepCard>

        <StepCard n={3} title="bind your telegram" active={step === 3} done={step > 3}>
          <BindTelegram enabled={step === 3} onDone={() => setTgDone(true)} />
        </StepCard>

        <StepCard n={4} title="you're in" active={step === 4} done={false}>
          <p className="text-sm text-dim">
            check telegram for your single-use invite link (valid 10 min). message the bot with
            {" "}<span className="mono">/status</span> to see what&apos;s linked, or
            {" "}<span className="mono">/unlink</span> to drop it.
          </p>
        </StepCard>
      </div>

      <SafetyAccordion />
    </div>
  );
}

/* ─── step 2: self-transaction (default) + SIWE fallback link ─────────── */
function ProveOwnership({
  address,
  isHolder,
  session,
  loading,
}: {
  address: `0x${string}`;
  isHolder: boolean;
  session: { balance: number; method: "siwe" | "tx" } | null;
  loading: boolean;
}) {
  const qc = useQueryClient();
  const { sendTransactionAsync } = useSendTransaction();
  const client = usePublicClient();
  const sig = useVerifyBySignature();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [pastedHash, setPastedHash] = useState("");
  const [showSig, setShowSig] = useState(false);

  const addrLower = address.toLowerCase();

  const issue = useMutation({
    mutationFn: () =>
      j<Challenge>("/api/join/challenge", {
        method: "POST",
        body: JSON.stringify({ address: addrLower }),
      }),
    onSuccess: (d) => setChallenge(d),
    onError: (e) => toast.bad("couldn't start challenge", (e as Error).message.split("\n")[0]),
  });

  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (session) return;
    if (askedFor.current === addrLower) return;
    askedFor.current = addrLower;
    issue.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrLower, session]);

  const confirm = useMutation({
    mutationFn: (hash: string) =>
      j<{ address: `0x${string}`; balance: number; method: "tx" }>("/api/join/confirm", {
        method: "POST",
        body: JSON.stringify({ address: addrLower, hash }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session"] });
      toast.ok("verified", "self-transaction accepted");
    },
    onError: (e) => toast.bad("confirmation failed", (e as Error).message.split("\n")[0]),
  });

  async function sendSelfTx() {
    if (!challenge || !client) return;
    try {
      const hash = await sendTransactionAsync({
        to: address,
        value: BigInt(challenge.amountWei),
        chainId: CHAIN_ID,
      });
      toast.info("tx sent", "waiting for inclusion…");
      await client.waitForTransactionReceipt({ hash, confirmations: 1 });
      await confirm.mutateAsync(hash);
    } catch (e) {
      toast.bad("couldn't send", (e as Error).message.split("\n")[0]);
    }
  }

  const remaining = useCountdown(challenge?.expiresAt ?? 0);

  if (session) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className={`pill ${isHolder ? "pill-ok" : "pill-warn"}`}>
          <Icon name={isHolder ? "check" : "warn"} className="h-3 w-3" />
          {isHolder ? `holder · ${session.balance} simp` : "0 simp"}
        </span>
        <span className="pill">{session.method === "siwe" ? "signature" : "self-tx"}</span>
        {!isHolder && (
          <a className="link text-xs" href={LINKS.opensea} target="_blank" rel="noreferrer">
            this wallet holds no simp cult nft — get one on opensea →
          </a>
        )}
      </div>
    );
  }

  const busy = issue.isPending || confirm.isPending || sig.isPending || loading;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-dim">
        send a tiny self-transaction — <span className="text-text">from your wallet, to your wallet</span> — with a
        unique random amount we assign you. only gas is spent; the amount never leaves your wallet.
      </p>

      {challenge ? (
        <div className="rounded-xl border border-line bg-black/30 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-mute">send exactly</div>
              <div className="mono mt-1 text-[22px] text-white">
                {challenge.amountMon} <span className="text-dim">MON</span>
              </div>
            </div>
            <div className="text-right text-[11px] text-mute">
              <div>to {short(address)}</div>
              <div>expires in {remaining}</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={sendSelfTx} disabled={busy}>
              {confirm.isPending ? <Icon name="spinner" /> : <><Icon name="wallet" className="h-4 w-4" /> send with wallet</>}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                askedFor.current = null;
                setChallenge(null);
                setPastedHash("");
                issue.mutate();
              }}
              disabled={busy}
              aria-label="new amount"
            >
              new amount
            </button>
          </div>

          <details className="group mt-4 text-sm">
            <summary className="cursor-pointer text-dim hover:text-white">i sent it manually (hardware wallet) ↓</summary>
            <div className="mt-3 space-y-2">
              <p className="text-xs text-dim">
                already sent the exact amount from your wallet to itself? paste the tx hash — we&apos;ll verify from == to, value and the 15-minute window.
              </p>
              <input
                className="input mono"
                placeholder="0x…"
                value={pastedHash}
                onChange={(e) => setPastedHash(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                className="btn btn-primary w-full"
                onClick={() => confirm.mutate(pastedHash.trim())}
                disabled={busy || !pastedHash.trim()}
              >
                {confirm.isPending ? <Icon name="spinner" /> : "verify this hash"}
              </button>
            </div>
          </details>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-mute"><Icon name="spinner" /> requesting a challenge…</div>
      )}

      {confirm.error && <p className="text-xs text-bad">{(confirm.error as Error).message}</p>}

      <div className="text-xs text-mute">
        or{" "}
        <button type="button" className="link" onClick={() => setShowSig((s) => !s)}>
          sign a message instead (free)
        </button>
        {showSig && (
          <div className="mt-2 flex items-center gap-2">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => sig.mutate()}
              disabled={sig.isPending}
            >
              {sig.isPending ? <Icon name="spinner" /> : "sign & verify"}
            </button>
            <span className="text-mute">— no gas, no transaction.</span>
          </div>
        )}
      </div>

      {sig.error && <p className="text-xs text-bad">{(sig.error as Error).message.split("\n")[0]}</p>}
    </div>
  );
}

function useCountdown(expiresAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return "—";
  const secs = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ─── step 3: telegram binding ────────────────────────────────────────── */
function BindTelegram({ enabled, onDone }: { enabled: boolean; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const trimmed = username.trim().replace(/^@/, "");
  const valid = USERNAME_RE.test(trimmed);

  const link = useMutation({
    mutationFn: () =>
      j<{ url: string; expiresIn: number }>("/api/telegram/link", {
        method: "POST",
        body: JSON.stringify({ username: trimmed }),
      }),
    onSuccess: (d) => {
      setUrl(d.url);
      window.open(d.url, "_blank", "noopener");
      onDone();
      toast.ok("code issued", "complete the handshake inside telegram");
    },
    onError: (e) => toast.bad("could not issue invite", (e as Error).message.split("\n")[0]),
  });

  if (!enabled && !url) {
    return <p className="text-sm text-dim">verify ownership first — then we&apos;ll bind your telegram.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-dim">
        enter the <span className="text-text">@username</span> on the telegram account you&apos;ll use. the bot only
        accepts the handshake from that exact account.
      </p>
      <label htmlFor="tg-user" className="sr-only">telegram username</label>
      <div className="flex gap-2">
        <input
          id="tg-user"
          className="input mono"
          placeholder="@yourhandle"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={username.length > 0 && !valid}
        />
        <button
          className="btn btn-primary"
          onClick={() => link.mutate()}
          disabled={!valid || link.isPending}
        >
          {link.isPending ? <Icon name="spinner" /> : <><Icon name="telegram" className="h-4 w-4" /> open telegram</>}
        </button>
      </div>
      {username.length > 0 && !valid && (
        <p className="text-xs text-bad">5–32 characters: letters, digits, underscore.</p>
      )}
      {url && (
        <p className="text-xs text-dim">
          didn&apos;t open? <a className="link" href={url} target="_blank" rel="noreferrer">tap here</a> · code expires in 10 min.
        </p>
      )}
      {link.error && <p className="text-xs text-bad">{(link.error as Error).message}</p>}
    </div>
  );
}

/* ─── "how this stays safe" accordion (replaces /security) ─────────────── */
function SafetyAccordion() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-xl border border-line bg-black/20 px-4 py-3 text-left text-sm text-dim hover:bg-black/30"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Icon name="shield" className="h-4 w-4 text-simp-2" /> how this stays safe
        </span>
        <span className={`transition ${open ? "rotate-45" : ""}`} aria-hidden>+</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <ul className="mt-3 list-disc space-y-2 rounded-xl border border-line bg-black/20 px-7 py-4 text-[13.5px] text-dim">
              <li><b className="text-text">no approvals, ever.</b> the only writes this site requests are dao propose/vote and your own self-transaction.</li>
              <li><b className="text-text">one chain.</b> wagmi is configured for monad (143) only — no silent chain switching.</li>
              <li><b className="text-text">readable signatures.</b> sign-in with ethereum names {SITE.domain}, your address and a single-use 5-min nonce.</li>
              <li><b className="text-text">single-use invites.</b> telegram links expire in 10 min; membership is re-checked hourly and non-holders are kicked.</li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── collapsible step card ───────────────────────────────────────────── */
function StepCard({
  n,
  title,
  active,
  done,
  children,
}: {
  n: number;
  title: string;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`glass relative p-6 transition ${active ? "pulse-neon border-simp/60" : ""} ${
        !active && !done ? "opacity-55" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`relative z-10 grid h-7 w-7 place-items-center rounded-full text-xs font-semibold transition-colors ${
            done ? "bg-ok/25 text-ok" : active ? "bg-simp/25 text-simp-2" : "bg-white/5 text-mute"
          }`}
          aria-hidden
        >
          {done ? <Icon name="check" className="h-3.5 w-3.5" /> : n}
        </span>
        <h3 className="t-h3 text-[17px]">{title}</h3>
      </div>
      <AnimatePresence initial={false}>
        {active && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pl-10">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
