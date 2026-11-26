"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { WalletButton } from "@/components/wallet/WalletButton";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/Toast";
import { useSession, useVerifyBySignature } from "@/lib/useSession";
import { useMounted } from "@/lib/useMounted";
import { short } from "@/lib/config";
import { MONAD_CARD_ENABLED, POINTS_CONFIG, nextUtcMidnight } from "@/lib/points/config";
import {
  api,
  compact,
  countdown,
  fmt,
  KIND_LABEL,
  POOL_LABEL,
  post,
  reasonLabel,
  timeAgo,
  useNow,
  type LeaderRow,
  type LedgerEntry,
  type Me,
  type SeasonInfo,
  type Submission,
  type SubmissionKind,
} from "./lib";

/* ───────────────────────────── shell ───────────────────────────── */

export function Portal() {
  const mounted = useMounted();
  const { isConnected } = useAccount();
  const { session, isLoading } = useSession();
  const season = useQuery({
    queryKey: ["points", "season"],
    queryFn: () => api<SeasonInfo>("/api/points/season"),
    refetchInterval: 60_000,
  });

  const signedIn = mounted && !!session;

  return (
    <>
      <PageHeader
        eyebrow={season.data ? (season.data.live ? `season ${season.data.season} is live` : "season 1 loading") : "simp machine"}
        title="SIMP Points"
        lead="check in, post about the cult, bring alpha. every simp move stacks points. every season the machine pays out half of what's left — forever."
        aside={<SeasonClock info={season.data} />}
      />

      {!mounted || isLoading ? (
        <div className="glass mt-12 h-48 animate-pulse" />
      ) : !isConnected ? (
        <Gate title="connect to start simping">
          <p className="t-body text-dim">holders earn from daily check-ins, x posts and alpha. holding alone pays too.</p>
          <div className="mt-5">
            <WalletButton />
          </div>
        </Gate>
      ) : !signedIn ? (
        <SignIn />
      ) : (
        <Dashboard season={season.data} />
      )}

      <div className="mt-16 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <SeasonMeter info={season.data} />
        <Leaderboard me={session?.address} />
      </div>

      <HowItWorks />
    </>
  );
}

function Gate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="glass mt-12 p-7 sm:p-9">
      <h2 className="t-h2">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SignIn() {
  const sig = useVerifyBySignature();
  return (
    <Gate title="one signature and you're in">
      <p className="t-body text-dim">
        sign a message to prove the wallet is yours — free, no transaction, can&apos;t move anything. or use the{" "}
        <Link className="link" href="/join">
          self-transaction check
        </Link>
        .
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          className="btn btn-primary"
          disabled={sig.isPending}
          onClick={() =>
            sig.mutate(undefined, {
              onError: (e) => toast.bad("signature didn't go through", (e as Error).message.split("\n")[0]),
            })
          }
        >
          {sig.isPending ? <Icon name="spinner" className="h-4 w-4 animate-spin" /> : <Icon name="shield" className="h-4 w-4" />}
          sign in (free)
        </button>
        <WalletButton />
      </div>
    </Gate>
  );
}

function SeasonClock({ info }: { info?: SeasonInfo }) {
  const now = useNow();
  if (!info || now === null) return <span className="pill">season —</span>;
  const target = info.live ? info.end : info.start;
  return (
    <span className="pill pill-simp num" title={new Date(target).toUTCString()}>
      {info.live ? `s${info.season} ends in` : "starts in"} {countdown(target - now)}
    </span>
  );
}

/* ───────────────────────────── dashboard ───────────────────────────── */

function useMe() {
  return useQuery({ queryKey: ["points", "me"], queryFn: () => api<Me>("/api/points/me"), staleTime: 10_000 });
}

function Dashboard({ season }: { season?: SeasonInfo }) {
  const me = useMe();
  if (me.isLoading) return <div className="glass mt-12 h-48 animate-pulse" />;
  if (me.error || !me.data)
    return (
      <Gate title="couldn't load your points">
        <p className="t-body text-dim">{(me.error as Error)?.message ?? "try again in a moment"}</p>
        <button className="btn btn-ghost mt-4" onClick={() => me.refetch()}>
          retry
        </button>
      </Gate>
    );
  const m = me.data;
  return (
    <div className="mt-12 grid grid-cols-1 gap-6">
      <div className="grid gap-6 md:grid-cols-[1.25fr_1fr]">
        <BalanceCard me={m} />
        <CheckinCard me={m} live={!!season?.live} />
      </div>
      {!m.holder && !m.monadCard.holder && (
        <div className="glass flex flex-wrap items-center justify-between gap-4 p-5">
          <p className="text-sm text-dim">
            this wallet holds no simp cult nft{MONAD_CARD_ENABLED ? " or monad card" : ""} — earning is for holders.
          </p>
          <a className="btn btn-ghost btn-sm" href="https://opensea.io/collection/monad-simp-cult" target="_blank" rel="noreferrer">
            find a simp <Icon name="external" className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
      <EarnPanel me={m} />
      <Activity me={m} />
      {m.admin && (
        <Link href="/portal/admin" className="btn btn-ghost w-fit">
          <Icon name="shield" className="h-4 w-4" /> admin queue
        </Link>
      )}
    </div>
  );
}

function BalanceCard({ me }: { me: Me }) {
  return (
    <div className="glass spot relative overflow-hidden p-7">
      <div className="flex items-center justify-between gap-3">
        <p className="t-wide-sm text-mute">balance</p>
        <span className="mono text-mute">{short(me.address)}</span>
      </div>
      <p className="mt-4 font-wide text-[clamp(40px,7vw,64px)] leading-none text-text num">
        {fmt(me.balance)}
        <span className="ml-3 align-middle text-base text-simp-3">pts</span>
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <span className="pill num">season earned · {fmt(me.rank.points)}</span>
        <span className="pill pill-simp num">{me.rank.rank ? `rank #${me.rank.rank}` : "unranked"}</span>
        {me.holder && <span className="pill pill-ok num">{me.nfts} simp{me.nfts === 1 ? "" : "s"} held</span>}
        {me.monadCard.holder && <span className="pill pill-ok">monad card</span>}
      </div>
      <p className="mt-6 text-xs text-mute">points that might mean something someday.</p>
    </div>
  );
}

function CheckinCard({ me, live }: { me: Me; live: boolean }) {
  const qc = useQueryClient();
  const now = useNow();
  const c = me.checkin;
  const m = useMutation({
    mutationFn: () => post<{ amount: number; streak: number; balance: number }>("/api/points/checkin", {}),
    onSuccess: (d) => {
      toast.ok(`+${fmt(d.amount)} points`, d.streak > 1 ? `${d.streak}-day streak. keep simping.` : "streak started. see you tomorrow.");
      qc.invalidateQueries({ queryKey: ["points"] });
    },
    onError: (e) => toast.bad("check-in failed", (e as Error).message),
  });
  const maxBonusDays = Math.round(POINTS_CONFIG.rewards.checkin.maxStreakBonus / POINTS_CONFIG.rewards.checkin.streakBonusPerDay) + 1;
  const disabled = !live || c.checkedInToday || !me.holder || m.isPending;

  return (
    <div className="glass flex flex-col p-7">
      <div className="flex items-center justify-between">
        <p className="t-wide-sm text-mute">daily check-in</p>
        <span className="pill num">🔥 {c.streak} day{c.streak === 1 ? "" : "s"}</span>
      </div>
      <p className="mt-4 text-sm text-dim">
        {c.checkedInToday
          ? `done for today. tomorrow pays ${fmt(c.nextReward)}.`
          : me.holder
            ? `today pays ${fmt(c.nextReward)} — streaks stack up to day ${maxBonusDays}.`
            : "hold a simp cult nft to check in."}
      </p>
      <div className="mt-auto pt-6">
        <button className="btn btn-primary btn-lg w-full" disabled={disabled} onClick={() => m.mutate()}>
          {m.isPending ? (
            <Icon name="spinner" className="h-4 w-4 animate-spin" />
          ) : c.checkedInToday ? (
            <Icon name="check" className="h-4 w-4" />
          ) : null}
          {c.checkedInToday ? "checked in" : live ? "check in" : "season not live"}
        </button>
        <p className="mt-3 text-center text-xs text-mute num">
          resets at 00:00 utc{now !== null ? ` · ${countdown(nextUtcMidnight(now) - now)}` : ""}
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────────── earn ───────────────────────────── */

function EarnPanel({ me }: { me: Me }) {
  const tabs: { id: SubmissionKind; label: string; show: boolean }[] = [
    { id: "x_post", label: "x post", show: true },
    { id: "simp_post", label: "simp post", show: MONAD_CARD_ENABLED },
    { id: "alpha", label: "alpha", show: true },
  ];
  const [tab, setTab] = useState<SubmissionKind>("x_post");
  const r = POINTS_CONFIG.rewards;

  return (
    <div className="glass p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="t-h2">earn more</h2>
        <div className="segment" role="tablist">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} data-active={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
        </div>
      </div>

      <div className="mt-6">
        {tab === "alpha" ? (
          <AlphaForm me={me} />
        ) : (
          <>
            <XHandle me={me} />
            <div className="divider my-6" />
            <PostForm
              me={me}
              kind={tab}
              blurb={
                tab === "x_post"
                  ? `post about simp cult on x (mention @monadsimpcult or "simp cult"), drop the link. up to ${r.xPost.dailyCap} a day.`
                  : `monad card holders: any post with the word "simp" counts. up to ${r.simpPost.dailyCap} a day.`
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

function XHandle({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [handle, setHandle] = useState("");
  const [url, setUrl] = useState("");
  const done = () => qc.invalidateQueries({ queryKey: ["points", "me"] });
  const claim = useMutation({
    mutationFn: () => post("/api/points/x-handle", { handle }),
    onSuccess: () => {
      setHandle("");
      done();
    },
    onError: (e) => toast.bad("couldn't save handle", (e as Error).message),
  });
  const verify = useMutation({
    mutationFn: () => post("/api/points/x-handle", { url }),
    onSuccess: () => {
      toast.ok("handle verified", "your posts now count instantly.");
      setUrl("");
      done();
    },
    onError: (e) => toast.bad("couldn't verify", (e as Error).message),
  });

  if (me.x?.verified)
    return (
      <p className="flex items-center gap-2 text-sm text-dim">
        <span className="pill pill-ok">
          <Icon name="check" className="h-3.5 w-3.5" /> @{me.x.handle}
        </span>
        verified — qualifying posts credit instantly.
      </p>
    );

  return (
    <div className="grid gap-4">
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          claim.mutate();
        }}
      >
        <label className="sr-only" htmlFor="x-handle">
          x handle
        </label>
        <input
          id="x-handle"
          className="input"
          placeholder={me.x ? `@${me.x.handle} — change handle` : "@yourhandle"}
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          autoComplete="off"
        />
        <button className="btn btn-ghost" disabled={!handle.trim() || claim.isPending}>
          {me.x ? "change" : "save handle"}
        </button>
      </form>
      {me.x && me.x.code && (
        <div className="rounded-[var(--r-md)] border border-line p-4">
          <p className="text-sm text-dim">
            <span className="text-text">@{me.x.handle}</span> isn&apos;t verified yet — posts go to manual review. to verify, post{" "}
            <button
              type="button"
              className="mono text-simp-3 underline decoration-dotted"
              onClick={() => navigator.clipboard?.writeText(me.x!.code!).then(() => toast.info("copied"))}
            >
              {me.x.code}
            </button>{" "}
            from that account and paste the link:
          </p>
          <form
            className="mt-3 flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              verify.mutate();
            }}
          >
            <input
              className="input"
              placeholder="https://x.com/you/status/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              inputMode="url"
            />
            <button className="btn btn-ghost" disabled={!url.trim() || verify.isPending}>
              {verify.isPending ? <Icon name="spinner" className="h-4 w-4 animate-spin" /> : null} verify
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function PostForm({ me, kind, blurb }: { me: Me; kind: "x_post" | "simp_post"; blurb: string }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const left = me.caps[kind];
  const eligible = kind === "x_post" ? me.holder : me.monadCard.holder;
  const m = useMutation({
    mutationFn: () => post<{ submission: Submission }>("/api/points/submit", { kind, url }),
    onSuccess: ({ submission }) => {
      setUrl("");
      if (submission.status === "approved") toast.ok(`+${fmt(submission.reward ?? 0)} points`, "post verified. simp on.");
      else toast.info("submitted for review", "an admin checks the queue — points land once approved.");
      qc.invalidateQueries({ queryKey: ["points"] });
    },
    onError: (e) => toast.bad("not submitted", (e as Error).message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <p className="text-sm text-dim">{blurb}</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor={`url-${kind}`}>
          post link
        </label>
        <input
          id={`url-${kind}`}
          className="input"
          placeholder="https://x.com/you/status/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          inputMode="url"
          disabled={!eligible || !me.x}
        />
        <button className="btn btn-primary" disabled={!eligible || !me.x || !url.trim() || left < 1 || m.isPending}>
          {m.isPending ? <Icon name="spinner" className="h-4 w-4 animate-spin" /> : null} submit
        </button>
      </div>
      <p className="mt-2 text-xs text-mute">
        {!me.x
          ? "add your x handle above first."
          : !eligible
            ? kind === "x_post"
              ? "x posts are for simp cult holders."
              : "simp posts are for monad card holders."
            : `${left} left today`}
      </p>
    </form>
  );
}

function AlphaForm({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState("");
  const left = me.caps.alpha;
  const m = useMutation({
    mutationFn: () =>
      post("/api/points/submit", {
        kind: "alpha",
        title,
        note,
        proof: proof
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      setTitle("");
      setNote("");
      setProof("");
      toast.info("alpha received", "admins review weekly. good alpha pays well.");
      qc.invalidateQueries({ queryKey: ["points"] });
    },
    onError: (e) => toast.bad("not submitted", (e as Error).message),
  });

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <p className="text-sm text-dim">
        found something the cult should know? built a tool, made art, ran a space? send it with proof — admins review and pay
        up to {compact(POINTS_CONFIG.rewards.alpha.max)} at season-1 rates.
      </p>
      <input className="input" placeholder="what is it?" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={!me.holder} />
      <textarea
        className="input"
        rows={4}
        placeholder="details (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        disabled={!me.holder}
      />
      <input
        className="input"
        placeholder="proof links — https://… (up to 3, space separated)"
        value={proof}
        onChange={(e) => setProof(e.target.value)}
        disabled={!me.holder}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-mute">{me.holder ? `${left} left today` : "alpha submissions are for simp cult holders."}</p>
        <button className="btn btn-primary" disabled={!me.holder || left < 1 || !title.trim() || !proof.trim() || m.isPending}>
          {m.isPending ? <Icon name="spinner" className="h-4 w-4 animate-spin" /> : null} send alpha
        </button>
      </div>
    </form>
  );
}

/* ───────────────────────────── activity ───────────────────────────── */

function Activity({ me }: { me: Me }) {
  const [tab, setTab] = useState<"history" | "submissions">("history");
  const now = useNow(30_000);
  const ledger = useQuery({
    queryKey: ["points", "ledger"],
    queryFn: () => api<{ entries: LedgerEntry[] }>("/api/points/ledger?limit=50"),
  });

  return (
    <div className="glass p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="t-h2">activity</h2>
        <div className="segment" role="tablist">
          <button role="tab" aria-selected={tab === "history"} data-active={tab === "history"} onClick={() => setTab("history")}>
            history
          </button>
          <button role="tab" aria-selected={tab === "submissions"} data-active={tab === "submissions"} onClick={() => setTab("submissions")}>
            submissions{me.submissions.some((s) => s.status === "pending") ? " ·" : ""}
          </button>
        </div>
      </div>

      <ul className="mt-5 divide-y divide-[var(--line)]">
        {tab === "history" ? (
          ledger.isLoading ? (
            <li className="py-6 text-sm text-mute">loading…</li>
          ) : !ledger.data?.entries.length ? (
            <li className="py-6 text-sm text-mute">nothing yet. a check-in is the easiest first point.</li>
          ) : (
            ledger.data.entries.map((e) => (
              <li key={`${e.id}-${e.ts}`} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-text">{reasonLabel(e)}</p>
                  <p className="text-xs text-mute">
                    s{e.season}
                    {now !== null ? ` · ${timeAgo(e.ts, now)}` : ""}
                  </p>
                </div>
                <span className={`font-wide text-sm num ${e.amount >= 0 ? "text-ok" : "text-bad"}`}>
                  {e.amount >= 0 ? "+" : "−"}
                  {fmt(Math.abs(e.amount))}
                </span>
              </li>
            ))
          )
        ) : !me.submissions.length ? (
          <li className="py-6 text-sm text-mute">no submissions yet.</li>
        ) : (
          me.submissions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-text">
                  {KIND_LABEL[s.kind]} ·{" "}
                  {s.url ? (
                    <a className="link" href={s.url} target="_blank" rel="noreferrer">
                      {s.url.replace(/^https:\/\//, "")}
                    </a>
                  ) : (
                    s.title
                  )}
                </p>
                <p className="text-xs text-mute">
                  {now !== null ? timeAgo(s.createdAt, now) : ""}
                  {s.reviewNote ? ` · “${s.reviewNote}”` : ""}
                </p>
              </div>
              <span className={`pill ${s.status === "approved" ? "pill-ok" : s.status === "rejected" ? "pill-bad" : "pill-warn"}`}>
                {s.status === "approved" ? `+${fmt(s.reward ?? 0)}` : s.status}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/* ───────────────────────────── season ───────────────────────────── */

function SeasonMeter({ info }: { info?: SeasonInfo }) {
  return (
    <div className="glass p-7">
      <div className="flex items-center justify-between gap-3">
        <h2 className="t-h2">season {info?.season ?? "—"} machine</h2>
        {info && <span className="pill num">{fmt(info.simps)} {info.simps === 1 ? "simp" : "simps"} earning</span>}
      </div>
      <p className="mt-2 text-sm text-dim">what each pool can still pay out this season. when a meter fills, that pool is done until next season.</p>
      <div className="mt-6 grid gap-5">
        {(info?.pools ?? []).map((p) => {
          const pct = p.budget > 0 ? Math.min(100, (p.emitted / p.budget) * 100) : 0;
          return (
            <div key={p.pool}>
              <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
                <span className="text-text">{POOL_LABEL[p.pool]}</span>
                <span className="text-mute num">
                  {compact(p.emitted)} / {compact(p.budget)}
                </span>
              </div>
              <div className="bar">
                <span
                  style={{
                    width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%`,
                    background: "linear-gradient(90deg, var(--simp-600), var(--simp-400))",
                  }}
                />
              </div>
            </div>
          );
        })}
        {!info && <div className="h-28 animate-pulse rounded-[var(--r-md)] bg-[var(--panel)]" />}
      </div>
    </div>
  );
}

function Leaderboard({ me }: { me?: string }) {
  const lb = useQuery({
    queryKey: ["points", "leaderboard"],
    queryFn: () => api<{ season: number; rows: LeaderRow[] }>("/api/points/leaderboard"),
    refetchInterval: 60_000,
  });
  const rows = lb.data?.rows.slice(0, 15) ?? [];
  return (
    <div className="glass p-7">
      <h2 className="t-h2">top simps · s{lb.data?.season ?? "—"}</h2>
      <p className="mt-2 text-sm text-dim">ranked by points earned this season.</p>
      <ol className="mt-5 grid gap-1">
        {lb.isLoading && <li className="text-sm text-mute">loading…</li>}
        {!lb.isLoading && rows.length === 0 && <li className="text-sm text-mute">the board is empty. first simp wins.</li>}
        {rows.map((r) => {
          const mine = me && r.address === me.toLowerCase();
          return (
            <li
              key={r.address}
              className={`flex items-center justify-between gap-3 rounded-[var(--r-sm)] px-3 py-2 ${mine ? "bg-[rgb(var(--simp-rgb)/0.12)]" : ""}`}
            >
              <span className="flex items-center gap-3">
                <span className={`font-wide w-7 text-xs num ${r.rank <= 3 ? "text-simp-3" : "text-mute"}`}>{r.rank}</span>
                <span className="mono text-dim">{mine ? "you" : short(r.address)}</span>
              </span>
              <span className="font-wide text-sm text-text num">{fmt(r.points)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function HowItWorks() {
  const r = POINTS_CONFIG.rewards;
  const items = [
    { k: "check in", v: `${fmt(r.checkin.base)}/day, streaks up to 2×`, n: "holders, once per utc day" },
    { k: "x post", v: `${fmt(r.xPost.reward)} each`, n: `about simp cult · ${r.xPost.dailyCap}/day` },
    { k: "alpha", v: `up to ${compact(r.alpha.max)}`, n: "admin-reviewed" },
    { k: "hold", v: "paid daily per simp", n: "just keep holding" },
  ];
  if (MONAD_CARD_ENABLED) items.splice(2, 0, { k: "simp post", v: `${fmt(r.simpPost.reward)} each`, n: "monad card holders" });
  return (
    <div className="mt-16">
      <h2 className="t-h2">how the machine pays</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((i) => (
          <div key={i.k} className="glass p-5">
            <p className="t-wide-sm text-mute">{i.k}</p>
            <p className="mt-3 text-text">{i.v}</p>
            <p className="mt-1 text-xs text-mute">{i.n}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-mute">
        season-1 rates shown. each season pays half the last, and rewards shrink with it. at season end your earned points settle
        onchain as soulbound xp — yours, non-transferable.
      </p>
    </div>
  );
}
