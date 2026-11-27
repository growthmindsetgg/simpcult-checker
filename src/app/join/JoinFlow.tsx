"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { isAddress } from "viem";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import {
  api,
  ApiError,
  humanError,
  useLogout,
  useSession,
  useVerifyBySignature,
  useVerifyByTransaction,
  SELFTX_STORAGE_KEY,
  type SelfTxChallenge,
  type SessionInfo,
} from "@/lib/useSession";
import { useMounted } from "@/lib/useMounted";
import { CHAIN, CHAIN_ID, SITE, short } from "@/lib/config";
import { WalletButton } from "@/components/wallet/WalletButton";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/Toast";

/*
 * /join
 *   1. how do you want to verify?   connect a wallet | send a transaction
 *   2. prove it                      SIWE signature  | "send and set" self-tx
 *   3. telegram (optional)           @handle for 3x points, skippable
 *   4. you're in
 * Non-holders can finish too: points have categories beyond holders.
 */

type Via = "wallet" | "send";
type TgLink = { handle: string; method: "declared" | "bot"; at: number };
type TgStatus = { link: TgLink | null; bot: boolean; holder: boolean };

const CHALLENGE_KEY = SELFTX_STORAGE_KEY;
/** holds the lowercase address that skipped, so a different wallet is still offered 3x */
const SKIP_KEY = "simp:tg-skip:v2";
const HANDLE_RE = /^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/;
const HASH_IN_TEXT = /0x[0-9a-fA-F]{64}/;

/* sessionStorage can throw (private mode, blocked storage): never let it break the flow */
const store = {
  get<T>(k: string): T | null {
    try {
      const v = window.sessionStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      window.sessionStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
  del(k: string) {
    try {
      window.sessionStorage.removeItem(k);
    } catch {}
  },
};

function savedChallenge(): SelfTxChallenge | null {
  const c = store.get<SelfTxChallenge>(CHALLENGE_KEY);
  return c && typeof c.nonce === "string" && c.tx && c.expiresAt > Date.now() ? c : null;
}

export function JoinFlow() {
  const mounted = useMounted();
  const { address, isConnected } = useAccount();
  const { session, serverSession, isLoading } = useSession();
  const connected = mounted && isConnected && !!address;

  // read once on the client; only shown after mount, so hydration never sees it
  const [via, setVia] = useState<Via | null>(() => {
    if (typeof window === "undefined") return null;
    if (savedChallenge()) return "send";
    const q = new URLSearchParams(window.location.search).get("via");
    return q === "send" || q === "wallet" ? q : null;
  });
  // a "?via=send" link followed while already on /join (the wallet modal has one)
  const qVia = useSearchParams().get("via");
  const [seenVia, setSeenVia] = useState(qVia);
  if (qVia !== seenVia) {
    setSeenVia(qVia);
    if (qVia === "send" || qVia === "wallet") setVia(qVia);
  }
  const [skippedFor, setSkippedFor] = useState<string | null>(() => (typeof window === "undefined" ? null : store.get<string>(SKIP_KEY)));
  const [editingTg, setEditingTg] = useState(false);

  const verified = mounted && !!session;
  const skipped = !!session && skippedFor === session.address.toLowerCase();
  const tg = useQuery({
    queryKey: ["telegram", session?.address ?? null],
    queryFn: () => api<TgStatus>("/api/telegram/link"),
    enabled: verified,
    staleTime: 30_000,
  });
  const link = tg.data?.link ?? null;

  const chosen: Via | null = !mounted ? null : (via ?? (connected ? "wallet" : null));
  const tgOpen = verified && (editingTg || (!tg.isLoading && !link && !skipped));
  const step = !verified ? (chosen ? 2 : 1) : tgOpen || tg.isLoading ? 3 : 4;

  const skip = () => {
    const who = session?.address.toLowerCase() ?? null;
    store.set(SKIP_KEY, who);
    setSkippedFor(who);
    setEditingTg(false);
  };

  return (
    <div className="mt-12">
      <ol
        className="relative space-y-4"
        aria-label="join steps"
        onPointerDown={(e) => (e.currentTarget.dataset.touched = "1")}
        onKeyDown={(e) => (e.currentTarget.dataset.touched = "1")}
      >
        <div className="step-track" aria-hidden>
          <motion.span
            initial={false}
            animate={{ height: `${((step - 1) / 3) * 100}%` }}
            transition={{ duration: 0.9, ease: [0.23, 1, 0.32, 1] }}
          />
        </div>

        <StepCard
          n={1}
          step={step}
          title="How do you want to verify?"
          summary={
            verified ? (
              <>Verified {session!.method === "siwe" ? "with a signature" : "with a self-transaction"}</>
            ) : chosen ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {chosen === "wallet" ? "With a connected wallet" : "By sending a transaction"}
                <button type="button" className="link text-[13px]" onClick={() => setVia(chosen === "wallet" ? "send" : "wallet")}>
                  {chosen === "wallet" ? "Send a transaction instead" : "Connect a wallet instead"}
                </button>
              </span>
            ) : null
          }
        >
          <ChooseVia onPick={setVia} />
        </StepCard>

        <StepCard
          n={2}
          step={step}
          title={chosen === "send" ? "Send and set" : "Prove it’s yours"}
          summary={verified ? <span className="mono">{short(session!.address)}</span> : null}
        >
          {chosen === "send" ? (
            <SendAndSet prefill={connected ? address : undefined} />
          ) : (
            <SignIn
              connected={connected}
              address={address}
              other={serverSession && !session ? serverSession : null}
              loading={isLoading}
              onSendInstead={() => setVia("send")}
            />
          )}
        </StepCard>

        <StepCard
          n={3}
          step={step}
          title="Telegram for 3x (optional)"
          summary={link ? <>@{link.handle} · 3x on</> : skipped ? "Skipped" : null}
        >
          {tg.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-mute">
              <Icon name="spinner" /> Checking…
            </p>
          ) : (
            <TelegramForm
              current={link}
              holder={tg.data?.holder ?? false}
              onDone={() => setEditingTg(false)}
              onSkip={skip}
              editing={editingTg}
            />
          )}
        </StepCard>

        <StepCard n={4} step={step} title="You’re in">
          {session && <Done session={session} status={tg.data ?? null} onEditTg={() => setEditingTg(true)} />}
        </StepCard>
      </ol>

      <SafetyAccordion />
    </div>
  );
}

/* ─── step 1: pick a path ─────────────────────────────────────────────── */
function ChooseVia({ onPick }: { onPick: (v: Via) => void }) {
  const opt =
    "glass glass-hover flex w-full items-start gap-3 rounded-[var(--r-lg)] px-4 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <button type="button" className={opt} onClick={() => onPick("wallet")}>
        <Icon name="wallet" className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
        <span>
          <span className="block text-[15px] font-medium text-text">Connect a wallet</span>
          <span className="mt-1 block text-[13px] leading-snug text-dim">Sign a message. Free, no transaction.</span>
        </span>
      </button>
      <button type="button" className={opt} onClick={() => onPick("send")}>
        <Icon name="external" className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
        <span>
          <span className="block text-[15px] font-medium text-text">Send a transaction</span>
          <span className="mt-1 block text-[13px] leading-snug text-dim">
            No connection here. Send 0 MON to yourself from any wallet app.
          </span>
        </span>
      </button>
    </div>
  );
}

/* ─── step 2a: connected wallet → SIWE (self-tx kept for wallets that can't sign) ── */
function SignIn({
  connected,
  address,
  other,
  loading,
  onSendInstead,
}: {
  connected: boolean;
  address?: `0x${string}`;
  other: SessionInfo | null;
  loading: boolean;
  onSendInstead: () => void;
}) {
  const sig = useVerifyBySignature();
  const tx = useVerifyByTransaction();
  const [cantSign, setCantSign] = useState(false);
  const busy = sig.isPending || tx.isPending;
  const err = sig.error ?? tx.error;

  if (!connected || !address) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-dim">Monad mainnet only. We never ask for approvals.</p>
        <WalletButton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {other && (
        <p className="text-[13px] text-dim">
          You&rsquo;re signed in as <span className="mono text-text">{short(other.address)}</span>. Sign with{" "}
          <span className="mono text-text">{short(address)}</span> to switch.
        </p>
      )}
      {!cantSign ? (
        <>
          <p className="text-sm leading-relaxed text-dim">
            Sign a plain-text message with <span className="mono text-text">{short(address)}</span>. It&rsquo;s not a
            transaction: no gas, and it can&rsquo;t move or approve anything.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => sig.mutate()}
            disabled={busy || loading}
            aria-busy={sig.isPending}
          >
            {sig.isPending ? (
              <>
                <Icon name="spinner" /> check your wallet
              </>
            ) : (
              "sign in (free)"
            )}
          </button>
          <p className="text-[13px] text-mute">
            Wallet can&rsquo;t sign messages?{" "}
            <button type="button" className="link" onClick={() => setCantSign(true)}>
              verify with a transaction
            </button>
          </p>
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-dim">
            Your wallet sends <span className="text-text">0 MON from {short(address)} to itself</span> with a one-time
            code in the data field. Only gas is spent.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => tx.mutate()} disabled={busy} aria-busy={tx.isPending}>
              {tx.isPending ? (
                <>
                  <Icon name="spinner" /> waiting for monad
                </>
              ) : (
                "send the 0-MON transaction"
              )}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setCantSign(false)} disabled={busy}>
              back to signing
            </button>
          </div>
          <p className="text-[13px] text-mute">
            Rather send it yourself?{" "}
            <button type="button" className="link" onClick={onSendInstead}>
              copy the details instead
            </button>
          </p>
        </>
      )}
      {err && (
        <p role="alert" className="text-xs text-bad">
          {humanError(err)}
        </p>
      )}
    </div>
  );
}

/* ─── step 2b: "send and set" — no wallet connection at all ───────────── */
function SendAndSet({ prefill }: { prefill?: string }) {
  const qc = useQueryClient();
  const ids = useId();
  const [challenge, setChallenge] = useState<SelfTxChallenge | null>(() => (typeof window === "undefined" ? null : savedChallenge()));
  const [addr, setAddr] = useState(() => challenge?.tx.from ?? prefill ?? "");
  const [hashRaw, setHashRaw] = useState("");
  const [note, setNote] = useState<{ tone: "bad" | "wait"; text: string } | null>(null);
  const remaining = useCountdown(challenge?.expiresAt ?? 0);
  const expired = !!challenge && remaining === "0:00";

  const addrTrim = addr.trim();
  const addrOk = isAddress(addrTrim, { strict: false });
  const hash = hashRaw.match(HASH_IN_TEXT)?.[0] ?? "";

  const issue = useMutation({
    mutationFn: () => api<SelfTxChallenge>("/api/auth/nonce", { method: "POST", body: JSON.stringify({ address: addrTrim }) }),
    onSuccess: (c) => {
      store.set(CHALLENGE_KEY, c);
      setChallenge(c);
      setHashRaw("");
      setNote(null);
    },
  });

  const verify = useMutation({
    mutationFn: () =>
      api<{ address: string; balance: number }>("/api/auth/verify-tx", {
        method: "POST",
        body: JSON.stringify({ hash, nonce: challenge!.nonce, address: challenge!.tx.from }),
      }),
    onMutate: () => setNote(null),
    onSuccess: (d) => {
      store.del(CHALLENGE_KEY);
      toast.ok("verified", `${short(d.address)} is yours`);
      qc.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (e) => setNote({ tone: e instanceof ApiError && e.status === 409 ? "wait" : "bad", text: humanError(e) }),
  });

  const reset = () => {
    store.del(CHALLENGE_KEY);
    setChallenge(null);
    setHashRaw("");
    setNote(null);
    issue.reset();
  };

  if (!challenge) {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (addrOk && !issue.isPending) issue.mutate();
        }}
      >
        <p className="text-sm leading-relaxed text-dim">
          Enter the wallet you want to verify. We&rsquo;ll give you a one-time code to send to yourself from that wallet,
          in any app. No keys, no seed phrase, nothing to connect.
        </p>
        <label htmlFor={`${ids}-addr`} className="t-label block">
          Your wallet address
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={`${ids}-addr`}
            name="address"
            className="input mono"
            placeholder="0x…"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            inputMode="text"
            aria-invalid={addrTrim.length > 0 && !addrOk}
            aria-describedby={`${ids}-addr-hint`}
          />
          <button type="submit" className="btn btn-primary shrink-0" disabled={!addrOk || issue.isPending} aria-busy={issue.isPending}>
            {issue.isPending ? <Icon name="spinner" /> : "get my code"}
          </button>
        </div>
        <p id={`${ids}-addr-hint`} className={`text-xs ${addrTrim.length > 0 && !addrOk ? "text-bad" : "text-mute"}`}>
          {addrTrim.length > 0 && !addrOk ? "That’s not a wallet address. It’s 0x plus 40 characters." : "Your public address, the one you receive to."}
        </p>
        {issue.error && (
          <p role="alert" className="text-xs text-bad">
            {humanError(issue.error)}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-dim">
        From <span className="mono text-text">{short(challenge.tx.from)}</span>, send this transaction{" "}
        <span className="text-text">to yourself</span>. Only gas is spent; nothing leaves your wallet.
      </p>

      {/* the slip: what to type into the wallet app */}
      <div className="rounded-[3px] bg-[linear-gradient(168deg,#f8efdd,var(--paper)_45%,var(--paper-2))] px-4 py-4 text-[var(--paper-ink)] shadow-[0_14px_30px_-16px_rgba(0,0,0,0.9)] sm:px-5">
        <dl className="space-y-3.5 text-[13px]">
          <SlipRow label="Network">
            {CHAIN.name.toLowerCase()} · chain id {CHAIN_ID}
          </SlipRow>
          <SlipRow label="To (your own address)" copy={challenge.tx.to} copyLabel="copy the to address">
            <span className="mono break-all">{challenge.tx.to}</span>
          </SlipRow>
          <SlipRow label="Amount">
            <span className="mono">0 MON</span>
          </SlipRow>
          <SlipRow label="Data (hex)" copy={challenge.tx.data} copyLabel="copy the data">
            <span className="mono break-all">{challenge.tx.data}</span>
          </SlipRow>
        </dl>
        <p className="mt-4 border-t border-[rgba(43,19,32,0.15)] pt-3 text-[12.5px] leading-relaxed text-[rgba(43,19,32,0.75)]">
          Paste the data into your wallet&rsquo;s <i>hex data</i> or <i>data</i> field. Some wallets hide it under
          advanced settings. Code {expired ? "expired" : <>expires in <span className="mono">{remaining}</span></>}.
        </p>
      </div>

      {expired ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-bad">This code expired. Get a new one and send a new transaction with it.</p>
          <button type="button" className="btn btn-primary" onClick={() => issue.mutate()} disabled={issue.isPending} aria-busy={issue.isPending}>
            {issue.isPending ? <Icon name="spinner" /> : "get a new code"}
          </button>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (hash && !verify.isPending) verify.mutate();
          }}
        >
          <label htmlFor={`${ids}-hash`} className="t-label block">
            Sent it? Paste the transaction hash
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={`${ids}-hash`}
              name="tx-hash"
              className="input mono"
              placeholder="0x…"
              value={hashRaw}
              onChange={(e) => setHashRaw(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              aria-invalid={hashRaw.trim().length > 0 && !hash}
              aria-describedby={`${ids}-hash-hint`}
            />
            <button type="submit" className="btn btn-primary shrink-0" disabled={!hash || verify.isPending} aria-busy={verify.isPending}>
              {verify.isPending ? (
                <>
                  <Icon name="spinner" /> checking
                </>
              ) : (
                "verify"
              )}
            </button>
          </div>
          <p id={`${ids}-hash-hint`} className={`text-xs ${hashRaw.trim().length > 0 && !hash ? "text-bad" : "text-mute"}`}>
            {hashRaw.trim().length > 0 && !hash
              ? "A hash is 0x plus 64 characters. An explorer link works too."
              : "From your wallet’s activity list or an explorer link."}
          </p>
          {note && (
            <p role="alert" className={`text-xs ${note.tone === "bad" ? "text-bad" : "text-warn"}`}>
              {note.text}
            </p>
          )}
        </form>
      )}

      <p className="text-[13px] text-mute">
        Wrong address?{" "}
        <button type="button" className="link" onClick={reset} disabled={verify.isPending}>
          start over
        </button>{" "}
        (a transaction already sent with this code won&rsquo;t count after that).
      </p>
    </div>
  );
}

function SlipRow({ label, copy, copyLabel, children }: { label: string; copy?: string; copyLabel?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="font-serif text-[13.5px] italic text-[rgba(43,19,32,0.7)]">{label}</dt>
      <dd className="flex items-start justify-between gap-3 text-[var(--paper-ink)]">
        <span className="min-w-0 flex-1 pt-1.5">{children}</span>
        {copy && <CopyButton value={copy} label={copyLabel ?? `copy ${label}`} />}
      </dd>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.warn("Couldn’t copy", "Select the text and copy it by hand.");
    }
  }
  return (
    <button type="button" className="btn btn-ghost btn-on-paper btn-sm shrink-0" onClick={copy} aria-label={label}>
      <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
      <span aria-hidden>{copied ? "copied" : "copy"}</span>
      <span className="sr-only" aria-live="polite">
        {copied ? "copied" : ""}
      </span>
    </button>
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
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, "0")}`;
}

/* ─── step 3: telegram, optional, declared by default ─────────────────── */
function TelegramForm({
  current,
  holder,
  editing,
  onDone,
  onSkip,
}: {
  current: TgLink | null;
  holder: boolean;
  editing: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const qc = useQueryClient();
  const ids = useId();
  const [raw, setRaw] = useState(current?.handle ?? "");
  const [mine, setMine] = useState(false);
  const handle = raw.trim().replace(/^@/, "");
  const valid = HANDLE_RE.test(handle);

  const save = useMutation({
    mutationFn: () => api<{ link: TgLink }>("/api/telegram/link", { method: "POST", body: JSON.stringify({ handle }) }),
    onSuccess: (d) => {
      toast.ok("Telegram added", `@${d.link.handle} · 3x on every activity`);
      qc.invalidateQueries({ queryKey: ["telegram"] });
      onDone();
    },
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && mine && !save.isPending) save.mutate();
      }}
    >
      <p className="text-sm leading-relaxed text-dim">
        Add your Telegram for <span className="text-text">3x points on every activity</span>.
        {holder ? " Holders also use it for the holders’ chat." : ""} It&rsquo;s optional. Skip it and add it later.
      </p>
      <label htmlFor={`${ids}-tg`} className="t-label block">
        Telegram username
      </label>
      <input
        id={`${ids}-tg`}
        name="telegram-username"
        className="input mono"
        placeholder="@yourhandle"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        aria-invalid={handle.length > 0 && !valid}
        aria-describedby={`${ids}-tg-hint`}
      />
      <p id={`${ids}-tg-hint`} className={`text-xs ${handle.length > 0 && !valid ? "text-bad" : "text-mute"}`}>
        {handle.length > 0 && !valid
          ? "5–32 letters, digits or _, starting with a letter and not ending with _."
          : "The @name in your Telegram settings."}
      </p>
      <label className="flex cursor-pointer items-start gap-2.5 py-1 text-sm text-text">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--gold)]"
          checked={mine}
          onChange={(e) => setMine(e.target.checked)}
        />
        <span>This is my Telegram account</span>
      </label>
      {save.error && (
        <p role="alert" className="text-xs text-bad">
          {humanError(save.error)}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="submit" className="btn btn-primary" disabled={!valid || !mine || save.isPending} aria-busy={save.isPending}>
          {save.isPending ? (
            <Icon name="spinner" />
          ) : (
            <>
              <Icon name="telegram" className="h-4 w-4" /> {current ? "save handle" : "add telegram"}
            </>
          )}
        </button>
        {editing && current ? (
          <button type="button" className="btn btn-ghost" onClick={onDone} disabled={save.isPending}>
            cancel
          </button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={onSkip} disabled={save.isPending}>
            skip for now
          </button>
        )}
      </div>
    </form>
  );
}

/* ─── step 4: done ────────────────────────────────────────────────────── */
function Done({ session, status, onEditTg }: { session: SessionInfo; status: TgStatus | null; onEditTg: () => void }) {
  const qc = useQueryClient();
  const logout = useLogout();
  const link = status?.link ?? null;
  const holder = session.balance > 0;

  const remove = useMutation({
    mutationFn: () => api("/api/telegram/link", { method: "DELETE" }),
    onSuccess: () => {
      toast.info("Telegram removed", "3x is off until you add it again.");
      qc.invalidateQueries({ queryKey: ["telegram"] });
    },
    onError: (e) => toast.bad("Couldn’t remove it", humanError(e)),
  });
  const botVerify = useMutation({
    mutationFn: () => api<{ url: string }>("/api/telegram/verify", { method: "POST" }),
    onSuccess: (d) => {
      window.open(d.url, "_blank", "noopener,noreferrer");
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="pill pill-ok">
          Verified · <span className="mono">{short(session.address)}</span>
        </span>
        <span className={`pill ${holder ? "pill-simp" : ""}`}>{holder ? `Holder · ${session.balance} Simp` : "No Simp NFT"}</span>
        {link && <span className="pill pill-ok">Telegram 3x</span>}
      </div>

      <div className="space-y-2 text-sm text-dim">
        {link ? (
          <>
            <p>
              Telegram: <span className="mono text-text">@{link.handle}</span>
              {link.method === "bot" ? " · verified with the bot" : ""}. 3x is on for every activity.
            </p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              <button type="button" className="link" onClick={onEditTg}>
                Change handle
              </button>
              <button type="button" className="link" onClick={() => remove.mutate()} disabled={remove.isPending}>
                {remove.isPending ? "Removing…" : "Remove"}
              </button>
            </p>
            {status?.bot && holder && link.method === "declared" && (
              <div className="pt-2">
                <p className="text-[13px]">Want the holders&rsquo; chat? Confirm @{link.handle} with our bot for a one-time invite.</p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm mt-2"
                  onClick={() => botVerify.mutate()}
                  disabled={botVerify.isPending}
                  aria-busy={botVerify.isPending}
                >
                  {botVerify.isPending ? <Icon name="spinner" /> : <><Icon name="telegram" className="h-4 w-4" /> verify with the bot</>}
                </button>
                {botVerify.data && (
                  <p className="mt-2 text-xs">
                    Didn&rsquo;t open?{" "}
                    <a className="link" href={botVerify.data.url} target="_blank" rel="noreferrer">
                      Open Telegram
                    </a>
                    . The code works once, for 10 minutes, from @{link.handle}.
                  </p>
                )}
                {botVerify.error && (
                  <p role="alert" className="mt-2 text-xs text-bad">
                    {humanError(botVerify.error)}
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <p>
            No Telegram yet.{" "}
            <button type="button" className="link" onClick={onEditTg}>
              Add it for 3x points
            </button>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/portal" className="btn btn-primary">
          open the portal
        </Link>
        <button type="button" className="py-2 text-xs text-mute hover:text-text" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Sign out
        </button>
      </div>
    </div>
  );
}

/* ─── "how this stays safe" accordion ─────────────────────────────────── */
function SafetyAccordion() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mt-10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-[var(--r-lg)] border border-line px-4 py-3.5 text-left text-sm text-dim transition-colors hover:border-line-strong hover:text-text"
        aria-expanded={open}
        aria-controls={id}
      >
        <span className="flex items-center gap-2">
          <Icon name="shield" className="h-4 w-4 text-gold" /> How this stays safe
        </span>
        <span className={`text-gold transition-transform duration-200 ${open ? "rotate-45" : ""}`} aria-hidden>
          +
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <ul className="glass mt-3 list-disc space-y-2 px-7 py-4 text-[13.5px] leading-relaxed text-dim marker:text-mute">
              <li>
                <b className="text-text">No approvals, ever.</b> The only writes this site asks for are DAO propose/vote and
                your own 0-MON self-transaction.
              </li>
              <li>
                <b className="text-text">One chain.</b> Monad ({CHAIN_ID}) only. Nothing here asks you to switch.
              </li>
              <li>
                <b className="text-text">Readable signatures.</b> The sign-in message names {SITE.domain}, your address and a
                one-time code that expires in 5 minutes.
              </li>
              <li>
                <b className="text-text">One-time codes.</b> Each code works once, and only in the browser that asked for
                it. A transaction code lasts 15 minutes.
              </li>
              <li>
                <b className="text-text">Telegram is optional.</b> Your handle earns 3x. Holders&rsquo; chat invites are
                single-use and holders are re-checked hourly.
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── step card ───────────────────────────────────────────────────────── */
function StepCard({
  n,
  step,
  title,
  summary,
  children,
}: {
  n: number;
  step: number;
  title: string;
  /** one line shown under a finished step */
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  const active = step === n;
  const done = step > n;
  const heading = useRef<HTMLHeadingElement>(null);
  const prev = useRef(step);
  // move focus to the step that just opened, so keyboard and screen-reader
  // users aren't left on a button that disappeared. only after they've used the
  // flow and focus was in it (never on load, when the session simply arrives)
  useEffect(() => {
    const h = heading.current;
    const ol = h?.closest("ol");
    const focus = document.activeElement;
    if (prev.current !== step && active && h && ol?.dataset.touched && (focus === document.body || ol.contains(focus))) {
      h.focus({ preventScroll: true });
      h.closest("li")?.scrollIntoView({ block: "nearest" });
    }
    prev.current = step;
  }, [step, active]);

  return (
    <li
      className={`relative scroll-mt-28 rounded-[var(--r-lg)] p-5 sm:p-6 ${active ? "glass pulse-neon" : "border border-line"}`}
      aria-current={active ? "step" : undefined}
    >
      <div className="flex items-center gap-3">
        <span
          className={`mono relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors ${
            done
              ? "bg-ok/15 text-ok ring-1 ring-ok/40"
              : active
                ? "bg-gold text-ink shadow-[0_0_14px_rgb(var(--gold-rgb)/0.5)]"
                : "bg-bg-2 text-mute ring-1 ring-line-strong"
          }`}
          aria-hidden
        >
          {done ? <Icon name="check" className="h-3.5 w-3.5" /> : n}
        </span>
        <h2 ref={heading} tabIndex={-1} className={`t-h3 text-[19px] outline-none ${!active && !done ? "!text-mute" : ""}`}>
          <span className="sr-only">step {n}: </span>
          {title}
          {done && <span className="sr-only"> (done)</span>}
        </h2>
      </div>
      {done && summary && <div className="mt-2 pl-10 text-[13px] text-dim">{summary}</div>}
      <AnimatePresence initial={false}>
        {active && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            {/* the indent lines content up with the title on wide screens; phones get the full width */}
            <div className="mt-4 pl-0 sm:pl-10">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
