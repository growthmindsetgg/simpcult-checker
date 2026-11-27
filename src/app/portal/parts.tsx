"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/Toast";
import { WalletModal } from "@/components/wallet/WalletModal";
import { useVerifyBySignature } from "@/lib/useSession";
import { LINKS, short } from "@/lib/config";
import {
  MONAD_CARD_ENABLED,
  POINTS_CONFIG,
  POOLS,
  checkinReward,
  finalWindow,
  nextUtcMidnight,
  poolBudget,
  scaledReward,
  seasonAt,
  seasonBounds,
  utcDay,
  type PoolId,
} from "@/lib/points/config";
import {
  api,
  BUCKET_LABEL,
  countdown,
  fmt,
  KIND_LABEL,
  POOL_LABEL,
  post,
  reasonLabel,
  retryPolicy,
  slipNo,
  stamp,
  useNow,
  type LeaderRow,
  type LedgerEntry,
  type Me,
  type SeasonInfo,
  type Submission,
  type SubmissionKind,
} from "./lib";
import s from "./portal.module.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const MAX_STREAK_DAYS =
  Math.round(POINTS_CONFIG.rewards.checkin.maxStreakBonus / POINTS_CONFIG.rewards.checkin.streakBonusPerDay) + 1;

function Spin() {
  return <span className={s.spin} aria-hidden />;
}

/* ───────────────────────────── masthead ───────────────────────────── */

export function Mast({ info }: { info?: SeasonInfo }) {
  const now = useNow();
  // without the API (warming up) the clock still runs off the config
  const n = info?.season ?? Math.max(1, seasonAt(now ?? undefined));
  const live = info ? info.live : now !== null && seasonAt(now) >= 1;
  const { start, end } = info ?? seasonBounds(n);
  const target = now !== null ? (live ? end : start) : null;
  return (
    <header className={s.mast}>
      <div>
        <p className="t-eyebrow">The points desk</p>
        <h1 className={s.mastTitle}>SIMP Points</h1>
        <p className={s.mastLead}>
          Check in, post about the cult, bring alpha. Every simp move stacks points, and every season the machine pays
          out half of what’s left. Forever.
        </p>
      </div>
      <div className={s.clock}>
        <span className="t-eyebrow">Season {n}</span>
        <span className={s.clockTime} title={target ? new Date(target).toUTCString() : undefined}>
          {target !== null && now !== null ? `${live ? "closes in" : "opens in"} ${countdown(target - now)}` : "—"}
        </span>
      </div>
    </header>
  );
}

/* ───────────────────────────── balance plaque ───────────────────────────── */

export function Plaque({ me, empty = "signedout" }: { me?: Me; empty?: "signedout" | "signin" }) {
  return (
    <section className={s.plaque} aria-label="your balance">
      <div className={s.plaqueTop}>
        <h2 className="t-eyebrow">Your stack</h2>
        <span className={cx(s.mono, s.mute)} style={{ fontSize: 12 }}>
          {me ? short(me.address) : empty === "signin" ? "not signed in" : "no wallet"}
        </span>
      </div>
      {me && (
        <div style={{ marginTop: 10 }}>
          <span className={me.category === "none" ? "pill pill-warn" : "pill pill-simp"}>{me.categoryLabel}</span>
        </div>
      )}
      {me ? (
        <p className={s.bignum}>
          {fmt(me.balance)}
          <span className={s.bignumUnit}>pts</span>
        </p>
      ) : (
        <p className={s.bignumBlank}>
          {empty === "signin" ? "Sign in to see your stack." : "Connect a wallet to see your stack."}
        </p>
      )}
      <div className={s.engraved}>
        <div>
          <div className={s.engravedK}>Earned this season</div>
          <div className={s.engravedV}>{me ? fmt(me.rank.points) : "—"}</div>
        </div>
        <div>
          <div className={s.engravedK}>Rank</div>
          <div className={s.engravedV}>{me ? (me.rank.rank ? `#${me.rank.rank}` : "unranked") : "—"}</div>
        </div>
        <div>
          <div className={s.engravedK}>Simps held</div>
          <div className={s.engravedV}>{me ? me.nfts : "—"}</div>
        </div>
      </div>
      <p className={s.wink}>Points for the record. Nothing more, nothing less.</p>
    </section>
  );
}

/* ───────────────────────────── the check-in ticket ───────────────────────────── */

export type TicketVariant = "live" | "signedout" | "signin" | "members" | "closed";

export function CheckinTicket({ variant, me, season }: { variant: TicketVariant; me?: Me; season: number }) {
  const qc = useQueryClient();
  const now = useNow();
  const [fresh, setFresh] = useState(false);
  const [paidNow, setPaidNow] = useState<number | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const sig = useVerifyBySignature();
  const punch = useMutation({
    mutationFn: () => post<{ amount: number; streak: number; balance: number }>("/api/points/checkin", {}),
    onSuccess: (d) => {
      setFresh(true);
      setPaidNow(d.amount);
      toast.ok(
        `+${fmt(d.amount)} points now`,
        `${d.streak > 1 ? `Day ${d.streak}.` : "Streak started."} Your share of today’s pool lands at 00:00 UTC.`,
      );
      qc.invalidateQueries({ queryKey: ["points"] });
    },
    onError: (e) => toast.bad("Ticket didn’t punch", (e as Error).message),
  });

  const c = me?.checkin;
  const punched = variant === "live" && !!c?.checkedInToday;
  const streak = c?.streak ?? 0;
  const holes = Math.min(streak, MAX_STREAK_DAYS);
  const todayPays = c
    ? punched
      ? checkinReward(Math.max(1, season), streak)
      : c.nextReward
    : checkinReward(Math.max(1, season), 1);
  const day = now !== null ? utcDay(now) : "";

  let note: ReactNode;
  const mult = me?.telegram.multiplier ?? 1;
  if (variant === "signedout")
    note = "Connect a wallet to get today’s ticket. One per day, for every wallet in the season.";
  else if (variant === "signin")
    note = "One free signature proves the wallet is yours. No transaction, and it can’t move anything.";
  else if (variant === "members")
    note = `This wallet isn’t in the season. Hold a Simp${MONAD_CARD_ENABLED ? " or a Monad Card" : ""}, or make ${POINTS_CONFIG.tx.activeUser}+ transactions on Monad.`;
  else if (variant === "closed") note = "The doors aren’t open yet. Season 1 starts soon.";
  else if (punched)
    note = (
      <>
        Punched. The rest of your ticket lands as a share of today’s pool at 00:00 UTC
        {streak + 1 <= MAX_STREAK_DAYS ? "" : " (max streak)"}.
      </>
    );
  else
    note = (
      <>
        Check-in today: <b>{fmt(me?.today?.checkinNow ?? todayPays * mult)}</b> now, plus a share of today’s pool at
        00:00 UTC
        {me?.today ? ` (max ${fmt(me.today.maxToday)} a day)` : ""}. The fewer who show up, the bigger it gets. Streaks
        weigh +10% a day, up to 2× on day {MAX_STREAK_DAYS}
        {mult > 1 ? `, and Telegram weighs ${mult}×` : ""}.
      </>
    );

  const stampFor = punched ? (
    <span className={s.stamp} data-fresh={fresh} aria-hidden>
      <small>paid</small>
      <span className={s.stampBig}>{fresh && paidNow !== null ? `+${fmt(paidNow)}` : "in"}</span>
      <small>{day}</small>
    </span>
  ) : variant === "members" ? (
    <span className={s.stamp} aria-hidden>
      <span className={s.stampBig}>not in</span>
      <small>this season</small>
    </span>
  ) : variant === "signedout" ? (
    <span className={s.stamp} data-tone="void" aria-hidden>
      <span className={s.stampBig}>void</span>
      <small>no wallet</small>
    </span>
  ) : null;

  return (
    <section className={s.ticketWrap} aria-label="daily check-in">
      <div className={cx(s.paper, s.ticket)}>
        <div className={s.ticketMain}>
          <div className={s.ticketHead}>
            <span>Daily ticket</span>
            <span>{day || "—"}</span>
          </div>
          <div>
            <p className={s.admit}>Admit one simp</p>
            <p className={s.ticketNote}>{note}</p>
          </div>
          <div>
            <ol className={s.holes} aria-label={`streak: ${streak} day${streak === 1 ? "" : "s"}`}>
              {Array.from({ length: MAX_STREAK_DAYS }, (_, i) => (
                <li
                  key={i}
                  className={s.hole}
                  data-punched={i < holes}
                  data-today={variant === "live" && !punched && i === holes}
                />
              ))}
            </ol>
            <div className={s.holesKey}>
              {variant === "live" || variant === "members"
                ? `Streak ${streak} day${streak === 1 ? "" : "s"}${streak >= MAX_STREAK_DAYS ? ", max bonus" : ""}`
                : `${MAX_STREAK_DAYS} punches to a 2× ticket`}
            </div>
          </div>
          {stampFor}
          {punched && <span className={s.srOnly}>checked in today</span>}
        </div>
        <div className={s.ticketStub}>
          <span>no. {String(streak).padStart(4, "0")}</span>
        </div>
      </div>

      <div className={s.ctaRow}>
        {variant === "live" && !punched && (
          <button
            className={cx("btn btn-primary btn-lg", s.wide)}
            disabled={punch.isPending}
            aria-busy={punch.isPending}
            onClick={() => punch.mutate()}
          >
            {punch.isPending ? <Spin /> : null} punch today’s ticket
          </button>
        )}
        {variant === "live" && punched && (
          <span className={s.under}>
            Next ticket in {now !== null ? countdown(nextUtcMidnight(now) - now) : "—"}, at 00:00 UTC
          </span>
        )}
        {variant === "signedout" && (
          <>
            <button className={cx("btn btn-primary btn-lg", s.wide)} onClick={() => setWalletOpen(true)}>
              connect wallet
            </button>
            <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
          </>
        )}
        {variant === "signin" && (
          <>
            <button
              className="btn btn-primary btn-lg"
              disabled={sig.isPending}
              aria-busy={sig.isPending}
              onClick={() =>
                sig.mutate(undefined, {
                  onError: (e) => toast.bad("Signature didn’t go through", (e as Error).message.split("\n")[0]),
                })
              }
            >
              {sig.isPending ? <Spin /> : null} sign in (free)
            </button>
            <Link className={s.textBtn} href="/join">
              or the self-transaction check
            </Link>
          </>
        )}
        {variant === "members" && (
          <a className="btn btn-ghost" href={LINKS.opensea} target="_blank" rel="noreferrer">
            find a simp
          </a>
        )}
        {variant === "closed" && <span className={s.under}>Check back when the clock hits zero.</span>}
      </div>
    </section>
  );
}

/* ───────────────────────────── drop your slip ───────────────────────────── */

export function SlipDesk({ me, hot }: { me: Me; hot: boolean }) {
  const community = me.categories.card || me.categories.activeMonad;
  const tabs: { id: SubmissionKind; label: string }[] = [
    ...(me.seasonPost.open && me.category !== "none" ? [{ id: "season_post" as const, label: "season post" }] : []),
    ...(me.holder || !community ? [{ id: "x_post" as const, label: "x post" }] : []),
    ...(community ? [{ id: "simp_post" as const, label: "simp post" }] : []),
    ...(me.holder || me.categories.card || !community ? [{ id: "alpha" as const, label: "alpha" }] : []),
  ];
  const [picked, setTab] = useState<SubmissionKind | null>(null);
  const tab = picked && tabs.some((t) => t.id === picked) ? picked : tabs[0].id;
  const [last, setLast] = useState<Submission | null>(null);

  return (
    <section className={s.velvet} aria-labelledby="slip-title">
      <div className={s.panelHead}>
        <h2 id="slip-title" className={s.panelTitle}>
          Drop your slip
        </h2>
        <span className="t-label">
          {fmt(me.caps[tab] ?? 0)} {tab === "season_post" ? "tries left" : "left today"}
        </span>
      </div>

      <div className={s.tabs} role="tablist" aria-label="slip type">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="slip-panel"
            className={s.tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="slip-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className={cx(s.paper, s.slip)}>
        {tab === "alpha" ? (
          <AlphaSlip me={me} hot={hot} onDone={setLast} />
        ) : (
          <>
            <HandleRow me={me} />
            <PostSlip me={me} kind={tab} hot={hot} onDone={setLast} />
          </>
        )}
      </div>
      {last && <PrintedReceipt sub={last} />}
    </section>
  );
}

function HandleRow({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState("");
  const [url, setUrl] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["points", "me"] });
  const claim = useMutation({
    mutationFn: () => post("/api/points/x-handle", { handle }),
    onSuccess: () => {
      setHandle("");
      setEditing(false);
      refresh();
    },
    onError: (e) => toast.bad("Couldn’t save that handle", (e as Error).message),
  });
  const verify = useMutation({
    mutationFn: () => post("/api/points/x-handle", { url }),
    onSuccess: () => {
      toast.ok("Handle verified", "Your X posts now pay out on the spot.");
      setUrl("");
      refresh();
    },
    onError: (e) => toast.bad("Couldn’t verify", (e as Error).message),
  });

  if (me.x && !editing) {
    return (
      <div className={s.slipRow}>
        <div className={s.member}>
          <span>
            <span className={s.slipLabel}>Member </span> @{me.x.handle}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            {me.x.verified ? (
              <span className={s.verified}>verified</span>
            ) : (
              <span className={s.slipHint}>unverified</span>
            )}
            <button type="button" className={s.textBtn} style={{ color: "inherit" }} onClick={() => setEditing(true)}>
              change
            </button>
          </span>
        </div>
        {!me.x.verified && me.x.code && (
          <div className={s.codeBox}>
            Unverified posts wait for a human. To get paid on the spot, post{" "}
            <button
              type="button"
              className={s.code}
              title="copy"
              onClick={() => navigator.clipboard?.writeText(me.x!.code!).then(() => toast.info("Copied", me.x!.code))}
            >
              {me.x.code}
            </button>{" "}
            from @{me.x.handle}, then paste that post here.
            <form
              className={s.inline}
              style={{ marginTop: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                verify.mutate();
              }}
            >
              <label className={s.srOnly} htmlFor="verify-url">
                Link to your verification post
              </label>
              <input
                id="verify-url"
                className={s.field}
                placeholder="x.com/you/status/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                inputMode="url"
                autoComplete="off"
              />
              <button
                className={"btn btn-ghost btn-on-paper"}
                disabled={!url.trim() || verify.isPending}
                aria-busy={verify.isPending}
              >
                {verify.isPending ? <Spin /> : null} verify
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      className={s.slipRow}
      onSubmit={(e) => {
        e.preventDefault();
        claim.mutate();
      }}
    >
      <label className={s.slipLabel} htmlFor="x-handle">
        Your X handle
      </label>
      <div className={s.inline}>
        <input
          id="x-handle"
          className={s.field}
          placeholder={me.x ? `@${me.x.handle}` : "@yourhandle"}
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <button
          className={"btn btn-ghost btn-on-paper"}
          disabled={!handle.trim() || claim.isPending}
          aria-busy={claim.isPending}
        >
          {claim.isPending ? <Spin /> : null} {me.x ? "switch" : "save"}
        </button>
        {me.x && (
          <button type="button" className={s.textBtn} style={{ color: "inherit" }} onClick={() => setEditing(false)}>
            keep @{me.x.handle}
          </button>
        )}
      </div>
    </form>
  );
}

function PostSlip({
  me,
  kind,
  hot,
  onDone,
}: {
  me: Me;
  kind: "x_post" | "simp_post" | "season_post";
  hot: boolean;
  onDone: (s: Submission) => void;
}) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const left = me.caps[kind];
  const done = kind === "season_post" && me.seasonPost.state === "approved";
  const eligible =
    kind === "x_post"
      ? me.holder
      : kind === "simp_post"
        ? me.categories.card || me.categories.activeMonad
        : me.category !== "none" && me.seasonPost.open && !done;
  const r = POINTS_CONFIG.rewards;
  const n = Math.max(1, seasonAt());
  const mult = me.telegram.multiplier;
  const m = useMutation({
    mutationFn: () => post<{ submission: Submission }>("/api/points/submit", { kind, url }),
    onSuccess: ({ submission }) => {
      setUrl("");
      onDone(submission);
      qc.invalidateQueries({ queryKey: ["points"] });
    },
    onError: (e) => toast.bad("Slip bounced", (e as Error).message),
  });
  const ready = eligible && !!me.x && left > 0;

  return (
    <form
      className={s.slipRow}
      style={{ gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <p className={s.slipBlurb}>
        {kind === "x_post"
          ? `Post about Simp Cult on X (say “simp cult” or tag @monadsimpcult), then drop the link. Post today: ${fmt(me.today?.postNow ?? scaledReward(r.xPost.reward, n) * mult)} now, plus a share of today’s pool at 00:00 UTC. ${r.xPost.dailyCap} a day.`
          : kind === "simp_post"
            ? `Any post with the word “simp” counts. Post today: ${fmt(me.today?.postNow ?? scaledReward(r.simpPost.reward, n) * mult)} now, plus a share of today’s pool at 00:00 UTC. ${r.simpPost.dailyCap} a day.`
            : `The last 48 hours: post on X about next season (say “simp” and “season”), then drop the link. Posters split the season pot; the fewer who post, the bigger each share. No post, no share.`}
      </p>
      <div>
        <label className={s.slipLabel} htmlFor={`url-${kind}`}>
          Post link
        </label>
        <input
          id={`url-${kind}`}
          className={s.field}
          placeholder="https://x.com/you/status/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          inputMode="url"
          autoComplete="off"
          disabled={!ready}
        />
      </div>
      <div className={s.slipFoot}>
        <span className={s.slipHint}>
          {done
            ? "Season post is in. Your share is locked in."
            : !eligible
              ? kind === "x_post"
                ? "X posts are for Simp Cult holders."
                : kind === "simp_post"
                  ? `Simp posts are for Monad Card holders and active Monad users (${POINTS_CONFIG.tx.activeUser}+ txs).`
                  : "The season post opens in the last 48 hours."
              : !me.x
                ? "Add your handle above first."
                : left < 1
                  ? kind === "season_post"
                    ? "No tries left. A human checks the ones in review."
                    : "That’s today’s three. Back after 00:00 UTC."
                  : me.x.verified
                    ? kind === "season_post"
                      ? "Verified handle: counts on the spot if X confirms it."
                      : "Verified handle: pays on the spot if X confirms it."
                    : "Goes to the review pile until your handle is verified."}
        </span>
        <button
          className={hot ? "btn btn-primary" : "btn btn-ghost btn-on-paper"}
          disabled={!ready || !url.trim() || m.isPending}
          aria-busy={m.isPending}
        >
          {m.isPending ? <Spin /> : null} drop it in
        </button>
      </div>
    </form>
  );
}

function AlphaSlip({ me, hot, onDone }: { me: Me; hot: boolean; onDone: (s: Submission) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState("");
  const left = me.caps.alpha;
  const m = useMutation({
    mutationFn: () =>
      post<{ submission: Submission }>("/api/points/submit", {
        kind: "alpha",
        title,
        note,
        proof: proof
          .split(/[\s,]+/)
          .map((x) => x.trim())
          .filter(Boolean),
      }),
    onSuccess: ({ submission }) => {
      setTitle("");
      setNote("");
      setProof("");
      onDone(submission);
      qc.invalidateQueries({ queryKey: ["points"] });
    },
    onError: (e) => toast.bad("Slip bounced", (e as Error).message),
  });
  const allowed = me.holder || me.categories.card;
  const off = !allowed || left < 1;
  const max = scaledReward(POINTS_CONFIG.rewards.alpha.max, Math.max(1, seasonAt()));

  return (
    <form
      className={s.slipRow}
      style={{ gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <p className={s.slipBlurb}>
        Found something the cult should know? Built a tool, made art, ran a space? Send it with proof. A human reads
        every slip and good alpha pays up to {fmt(max)}.
      </p>
      <div>
        <label className={s.slipLabel} htmlFor="alpha-title">
          What is it
        </label>
        <input
          id="alpha-title"
          className={s.field}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          disabled={off}
        />
      </div>
      <div>
        <label className={s.slipLabel} htmlFor="alpha-note">
          Details (optional)
        </label>
        <textarea
          id="alpha-note"
          className={s.field}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          disabled={off}
        />
      </div>
      <div>
        <label className={s.slipLabel} htmlFor="alpha-proof">
          Proof links, up to 3
        </label>
        <input
          id="alpha-proof"
          className={s.field}
          placeholder="https://…"
          value={proof}
          onChange={(e) => setProof(e.target.value)}
          inputMode="url"
          autoComplete="off"
          disabled={off}
        />
      </div>
      <div className={s.slipFoot}>
        <span className={s.slipHint}>
          {!allowed
            ? "Alpha slips are for holders and Monad Card holders."
            : left < 1
              ? "Three a day. Back after 00:00 UTC."
              : "Reviewed weekly."}
        </span>
        <button
          className={hot ? "btn btn-primary" : "btn btn-ghost btn-on-paper"}
          disabled={off || title.trim().length < 4 || !proof.trim() || m.isPending}
          aria-busy={m.isPending}
        >
          {m.isPending ? <Spin /> : null} send it up
        </button>
      </div>
    </form>
  );
}

function PrintedReceipt({ sub }: { sub: Submission }) {
  const paid = sub.status === "approved";
  return (
    <div className={cx(s.paper, s.printed)} role="status" key={sub.id}>
      <div className={s.printedHead}>
        <span>slip no. {slipNo(sub.id)}</span>
        <span>{stamp(sub.createdAt)} utc</span>
      </div>
      <div>{KIND_LABEL[sub.kind]}</div>
      <div
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {sub.url ? sub.url.replace(/^https:\/\//, "") : sub.title}
      </div>
      <span className={s.printedStatus} data-tone={paid ? "ok" : undefined}>
        {paid ? `paid +${fmt(sub.reward ?? 0)}` : "in review"}
      </span>
      <div style={{ marginTop: 8, fontSize: 11.5, opacity: 0.7 }}>
        {paid
          ? sub.kind === "season_post"
            ? "X confirmed it. You’re in the season-pot split."
            : "X confirmed it. That’s the instant slice; your share of today’s pool lands at 00:00 UTC."
          : "A human checks the pile. Points land once it’s approved."}
      </div>
    </div>
  );
}

/* ───────────────────────────── your season ───────────────────────────── */

const CATEGORY_POOL: Record<Me["category"], string> = {
  holder: "Active pool, 69%",
  card: "Community: Monad Card holders, 9%",
  active_monad: "Community: active Monad users, 1%",
  none: "None this season",
};

export function Standing({ me, info }: { me: Me; info?: SeasonInfo }) {
  const now = useNow(30_000);
  const n = me.seasonPost.season;
  const w = info?.finalWindow ?? {
    ...finalWindow(n),
    open: me.seasonPost.open,
  };
  const sp = me.seasonPost;
  const out = me.category === "none";
  const h = me.holding;
  const shareRows = Object.entries(me.projected.share).filter(([b]) => b !== "holding") as [
    keyof typeof BUCKET_LABEL,
    number,
  ][];
  const wl = me.welcome;

  return (
    <section className={s.velvet} aria-labelledby="standing-title">
      <div className={s.panelHead}>
        <h2 id="standing-title" className={s.panelTitle}>
          Your season
        </h2>
        {me.telegram.bound ? (
          <span className="pill pill-ok">Telegram {me.telegram.multiplier}× on</span>
        ) : (
          !out && <span className="pill">Telegram {me.telegram.bonus}× off</span>
        )}
      </div>

      {out ? (
        <p className={s.standNote} style={{ fontSize: 14 }}>
          This wallet can’t earn this season. To join: hold a Simp Cult NFT
          {MONAD_CARD_ENABLED ? ", hold a Monad Card" : ""}, or make {POINTS_CONFIG.tx.activeUser}+ transactions on
          Monad
          {me.txCount !== null ? ` (you have ${fmt(me.txCount)})` : ""}.
        </p>
      ) : (
        <div className={s.standGrid}>
          <div>
            <div className="t-label">You earn in</div>
            <div className={s.engravedV}>{CATEGORY_POOL[me.category]}</div>
            {me.categories.holder && me.categories.card && (
              <p className={s.standNote}>Your card also opens simp posts in the 9% pool.</p>
            )}
          </div>
          {me.today && (
            <div>
              <div className="t-label">Today’s pool</div>
              <div className={s.engravedV}>{fmt(me.today.allowance)} pts</div>
              <p className={s.standNote}>
                Shared by {fmt(me.today.participants)} simp
                {me.today.participants === 1 ? "" : "s"} so far. Max today: {fmt(me.today.maxToday)}.{" "}
                {me.today.mine.units === 0
                  ? "Check in or post to get a share."
                  : me.today.mine.roomLeft === 0
                    ? // at the cap the close adds nothing more, so no "~0" share line
                      "You’ve hit today’s max. More activity still counts toward your season-end share."
                    : `Your share so far: ~${fmt(me.today.mine.provisional)}, paid at 00:00 UTC.`}
                {me.today.yesterdayShare ? ` Yesterday’s share: +${fmt(me.today.yesterdayShare)}.` : ""}
              </p>
            </div>
          )}
          <div>
            <div className="t-label">Season-end share, estimate</div>
            <div className={s.engravedV}>
              {shareRows.length
                ? `${me.projected.basis === "if_all_post" ? "≥ " : "~"}${fmt(shareRows.reduce((a, [, v]) => a + v, 0))}`
                : "—"}
            </div>
            <p className={s.standNote}>
              {!shareRows.length
                ? "Earn this season to get a cut of the season pot."
                : me.projected.basis === "if_all_post"
                  ? "If everyone who earned posts in the final 48h. It depends on how many post: fewer posters, bigger shares."
                  : `Split with the ${fmt(me.projected.posters)} who’ve posted so far, if you post too. More posters, smaller shares.`}
              {shareRows.length > 0 && me.projected.includesUnspentDaily === false
                ? " Plus whatever of the daily budget goes unspent, added at season end."
                : ""}
            </p>
          </div>
          {(me.categories.holder || h.nftDays > 0) && (
            <div>
              <div className="t-label">Holding</div>
              <div className={s.engravedV}>
                {fmt(h.nftDays)} nft-day{h.nftDays === 1 ? "" : "s"}
                {me.projected.share.holding ? ` · ~${fmt(me.projected.share.holding)}` : ""}
              </div>
              <p className={s.standNote}>
                {h.missedSnapshot
                  ? "Missed a snapshot: no holding share this season."
                  : h.txOk === false
                    ? "Make 1 Monad transaction to get your holding share."
                    : `Snapshots ${h.snapshots.taken} of ${h.snapshots.total} passed. Hold through all of them.`}
              </p>
            </div>
          )}
          <div>
            <div className="t-label">Welcome bonus</div>
            <div className={s.engravedV}>
              {wl.status === "granted" ? `+${fmt(wl.amount)} paid` : wl.status === "pending" ? fmt(wl.amount) : "—"}
            </div>
            <p className={s.standNote}>
              {wl.status === "granted"
                ? "One time, done."
                : wl.status === "pending"
                  ? wl.reason === "holding_time" && wl.eta && now !== null
                    ? `Lands once you’ve held your Simp ${POINTS_CONFIG.welcome.holdMinutes} min: about ${countdown(wl.eta - now)}. Reopen the desk then.`
                    : "On its way. Check back soon."
                  : wl.reason === "tokens_used"
                    ? "Your Simp already brought a welcome bonus to another wallet."
                    : "For wallets in the season."}
            </p>
          </div>
        </div>
      )}

      {!out && !me.telegram.bound && (
        <p className={s.standNote} style={{ marginTop: 14 }}>
          Bind Telegram on <Link href="/join">the join page</Link> and every ticket, post and alpha pays{" "}
          {me.telegram.bonus}×. It weighs into your daily and season-end shares too. Optional.
        </p>
      )}

      {!out && (
        <div className={s.callout} data-hot={w.open && sp.state !== "approved"}>
          <span className="t-label">Season post</span>
          <p className={s.calloutText}>
            {sp.state === "approved"
              ? "Your season post is in. You’re splitting the season pot with the other posters."
              : w.open
                ? `It’s the last 48 hours. Post on X about next season and drop the link in the season post slip below${now !== null ? `: ${countdown(w.end - now)} left` : ""}. Posters split the season pot; the fewer who post, the bigger each share.`
                : `Post in the final 48h to split the season pot; the fewer who post, the bigger each share${now !== null && w.start > now ? `. Opens in ${countdown(w.start - now)}` : ""}.`}
            {sp.state === "pending" ? " Yours is in review." : ""}
          </p>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────── receipt roll ───────────────────────────── */

export function ReceiptRoll({ me }: { me: Me }) {
  const [view, setView] = useState<"ledger" | "slips">("ledger");
  const [shown, setShown] = useState(12);
  const ledger = useQuery({
    queryKey: ["points", "ledger"],
    queryFn: () => api<{ entries: LedgerEntry[] }>("/api/points/ledger?limit=50"),
    retry: retryPolicy,
  });
  const rows = ledger.data?.entries ?? [];
  const pending = me.submissions.filter((x) => x.status === "pending").length;

  return (
    <section className={cx(s.paper, s.roll)} aria-label="your receipts">
      <div className={s.rollHead}>
        <strong>simp machine</strong>
        points desk · {short(me.address)}
      </div>
      <div className={s.rollSwitch} role="tablist" aria-label="receipt view">
        <button role="tab" aria-selected={view === "ledger"} onClick={() => setView("ledger")}>
          ledger
        </button>
        <button role="tab" aria-selected={view === "slips"} onClick={() => setView("slips")}>
          slips{pending ? ` (${pending})` : ""}
        </button>
      </div>
      <hr className={s.rule} />
      {view === "ledger" ? (
        ledger.isLoading ? (
          <p className={s.empty}>Printing…</p>
        ) : ledger.error ? (
          <p className={s.empty}>The printer jammed. Reload in a sec.</p>
        ) : rows.length === 0 ? (
          <p className={s.empty}>Nothing printed yet. Today’s ticket is the easiest first line.</p>
        ) : (
          <ul className={s.lines}>
            {rows.slice(0, shown).map((e) => (
              <li key={`${e.id}-${e.ts}`} className={s.line}>
                <span className={s.lineWhen}>{stamp(e.ts)}</span>
                <span className={s.lineWhat} title={reasonLabel(e)}>
                  {reasonLabel(e)}
                </span>
                <span className={s.lineAmt} data-neg={e.amount < 0}>
                  {e.amount >= 0 ? "+" : "−"}
                  {fmt(Math.abs(e.amount))}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : me.submissions.length === 0 ? (
        <p className={s.empty}>No slips yet. Drop one on the left.</p>
      ) : (
        <ul className={s.lines}>
          {me.submissions.map((x) => (
            <li key={x.id} className={s.line}>
              <span className={s.lineWhen}>{stamp(x.createdAt)}</span>
              <span className={s.lineWhat} title={x.reviewNote ?? undefined}>
                {x.url ? (
                  <a href={x.url} target="_blank" rel="noreferrer">
                    {KIND_LABEL[x.kind]} · {x.url.replace(/^https:\/\/x\.com\//, "")}
                  </a>
                ) : (
                  `${KIND_LABEL[x.kind]} · ${x.title}`
                )}
              </span>
              <span className={cx(s.lineAmt, s.lineTag)} data-s={x.status}>
                {x.status === "approved" ? `+${fmt(x.reward ?? 0)}` : x.status === "pending" ? "review" : "void"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {view === "ledger" && rows.length > shown && (
        <div style={{ textAlign: "center" }}>
          <button className={s.textBtn} style={{ color: "inherit" }} onClick={() => setShown((n) => n + 12)}>
            print more
          </button>
        </div>
      )}
      <hr className={s.rule} />
      <div className={s.total}>
        <span>balance</span>
        <span>{fmt(me.balance)}</span>
      </div>
    </section>
  );
}

/* ───────────────────────────── season machine ───────────────────────────── */

const CHIPS: Record<PoolId, { n: number; color: string }> = {
  active: { n: 7, color: "#d9a845" },
  holding: { n: 2, color: "#e4d2b0" },
  monad: { n: 1, color: "#6e54ff" },
};

function Dial({ progress }: { progress: number | null }) {
  const cxp = 150;
  const cy = 150;
  const r = 118;
  const p = progress === null ? 0 : Math.min(1, Math.max(0, progress));
  const pt = (t: number, rr: number) => {
    const a = Math.PI * (1 - t);
    // rounded so server and client markup agree
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return [r2(cxp + rr * Math.cos(a)), r2(cy - rr * Math.sin(a))] as const;
  };
  const [ex, ey] = pt(p, r);
  const [nx, ny] = pt(p, r - 26);
  const days = POINTS_CONFIG.season.lengthDays;
  return (
    <svg
      className={s.dial}
      viewBox="0 0 300 168"
      role="img"
      aria-label={progress === null ? "season clock" : `season ${Math.round(p * 100)}% done`}
    >
      <defs>
        <linearGradient id="brass" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f6dc95" />
          <stop offset="0.45" stopColor="#d9a845" />
          <stop offset="1" stopColor="#7a5418" />
        </linearGradient>
      </defs>
      <path
        d={`M ${cxp - r} ${cy} A ${r} ${r} 0 0 1 ${cxp + r} ${cy}`}
        fill="none"
        stroke="#7a5418"
        strokeWidth="2"
        opacity="0.6"
      />
      {p > 0 && (
        <path
          d={`M ${cxp - r} ${cy} A ${r} ${r} 0 0 1 ${ex} ${ey}`}
          fill="none"
          stroke="url(#brass)"
          strokeWidth="4"
          strokeLinecap="round"
        />
      )}
      {Array.from({ length: days + 1 }, (_, i) => {
        const major = i % 7 === 0;
        const [x1, y1] = pt(i / days, r + 6);
        const [x2, y2] = pt(i / days, r + (major ? 18 : 11));
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={major ? "#d9a845" : "#7a5418"}
            strokeWidth={major ? 2 : 1}
          />
        );
      })}
      {Array.from({ length: 7 }, (_, w) => {
        const [x, y] = pt(w / 6, r - 14);
        return (
          <text
            key={w}
            x={x}
            y={y + 4}
            textAnchor="middle"
            fontSize="10"
            className={s.dialWeek}
            fontFamily="var(--font-mono, monospace)"
          >
            {w === 0 ? "" : `w${w}`}
          </text>
        );
      })}
      {progress !== null && (
        <>
          <line x1={cxp} y1={cy} x2={nx} y2={ny} stroke="url(#brass)" strokeWidth="3" strokeLinecap="round" />
          <circle cx={cxp} cy={cy} r="9" fill="url(#brass)" stroke="#2b1320" strokeWidth="1.5" />
          <circle cx={cxp} cy={cy} r="2.5" fill="#2b1320" />
        </>
      )}
    </svg>
  );
}

export function SeasonMachine({ info, warming }: { info?: SeasonInfo; warming?: boolean }) {
  const now = useNow(60_000);
  const n = info?.season ?? Math.max(1, seasonAt());
  const pools = info?.pools ?? POOLS.map((pool) => ({ pool, budget: poolBudget(pool, n), emitted: -1 }));
  const total = pools.reduce((a, p) => a + p.budget, 0);
  const nextTotal = POOLS.reduce((a, p) => a + poolBudget(p, n + 1), 0);
  const progress = info && info.live && now !== null ? (now - info.start) / (info.end - info.start) : null;
  const dayOf =
    progress !== null
      ? Math.min(POINTS_CONFIG.season.lengthDays, Math.floor(progress * POINTS_CONFIG.season.lengthDays) + 1)
      : null;

  return (
    <section className={s.velvet} aria-labelledby="season-title">
      <div className={s.panelHead}>
        <h2 id="season-title" className={s.panelTitle}>
          Season {n}
        </h2>
        <span className="t-label">{info ? `${fmt(info.simps)} simps earning` : warming ? "Warming up" : "—"}</span>
      </div>
      <div className={s.dialWrap}>
        <Dial progress={progress} />
        <div className={s.dialLabel}>
          {dayOf
            ? `Day ${dayOf} of ${POINTS_CONFIG.season.lengthDays}`
            : info && !info.live
              ? "Not started"
              : "Six weeks a season"}
        </div>
      </div>
      <div className={s.onTable}>
        <span className="t-eyebrow">On the table this season</span>
        <span className={s.onTableNum}>{fmt(total)}</span>
      </div>
      <ul className={s.rack}>
        {pools.map((p) => {
          const chip = CHIPS[p.pool];
          const taken = p.emitted > 0 && p.budget > 0 ? Math.floor((p.emitted / p.budget) * chip.n) : 0;
          const share = POINTS_CONFIG.poolBps[p.pool] / 100;
          return (
            <li key={p.pool} className={s.rackRow}>
              <div className={s.stack} aria-hidden>
                {Array.from({ length: chip.n }, (_, i) => (
                  <span
                    key={i}
                    className={s.chipDisc}
                    data-taken={i >= chip.n - taken}
                    style={{ ["--c" as string]: chip.color }}
                  />
                ))}
              </div>
              <div>
                <div className={s.rackName}>{POOL_LABEL[p.pool]}</div>
                <div className={s.rackMeta}>
                  {share}%, {p.emitted >= 0 ? `${fmt(p.emitted)} paid out` : "paid out: —"}
                </div>
              </div>
              <div className={s.rackAmt}>
                {fmt(p.budget)}
                <small>
                  {p.pool === "active"
                    ? "10% now, 90% at season end"
                    : p.pool === "holding"
                      ? "Once, at season end"
                      : MONAD_CARD_ENABLED
                        ? "Card 9% + Monad users 1%"
                        : "Monad users 1%, card 9% soon"}
                </small>
              </div>
            </li>
          );
        })}
      </ul>
      <div className={s.next}>
        <span>Next season: half.</span>
        <b>{fmt(nextTotal)}</b>
      </div>
    </section>
  );
}

/* ───────────────────────────── leaderboard ───────────────────────────── */

const BOARD_SIZE = 12;

export function Board({ me, myRank, warming }: { me?: string | null; myRank?: Me["rank"]; warming?: boolean }) {
  const lb = useQuery({
    queryKey: ["points", "leaderboard"],
    queryFn: () => api<{ season: number; rows: LeaderRow[] }>("/api/points/leaderboard"),
    refetchInterval: 60_000,
    retry: retryPolicy,
    enabled: !warming,
  });
  const live = !warming && !lb.isLoading && !lb.error;
  const rows = live ? (lb.data?.rows.slice(0, BOARD_SIZE) ?? []) : [];
  const mine = me?.toLowerCase();
  const meOnBoard = rows.some((r) => r.address === mine);
  const extra = !meOnBoard && !!myRank?.rank && !!me;
  // the board always shows its twelve places: empty ones print greyed, so the
  // card keeps its height next to the season card and reads as "not yet"
  const blanks = Math.max(0, BOARD_SIZE - rows.length - (extra ? 1 : 0));
  const status = warming
    ? "The board is still being engraved."
    : lb.isLoading
      ? "Reading the board…"
      : lb.error
        ? "Couldn’t read the board. It’ll be back."
        : rows.length === 0
          ? "Nobody on the board yet. The first simp to earn takes #1."
          : null;

  return (
    <section className={s.board} aria-labelledby="board-title">
      <div className={s.panelHead}>
        <h2 id="board-title" className={s.panelTitle}>
          Top simps
        </h2>
        <span className="t-label">Season {lb.data?.season ?? Math.max(1, seasonAt())}</span>
      </div>
      {status && (
        <p className={s.boardEmpty} role="status">
          {status}
        </p>
      )}
      <ol className={s.boardRows}>
        {rows.map((r) => {
          const isMe = r.address === mine;
          return (
            <li key={r.address} className={s.boardRow} data-top={r.rank <= 3} data-me={isMe}>
              <span className={s.boardRank}>{r.rank}</span>
              <span>
                {short(r.address)}
                {isMe && <span className={s.boardYou}>you</span>}
              </span>
              <span className={s.dots} aria-hidden />
              <span>{fmt(r.points)}</span>
            </li>
          );
        })}
        {Array.from({ length: blanks }, (_, i) => (
          <li key={`blank-${i}`} className={s.boardRow} data-blank="true" aria-hidden>
            <span className={s.boardRank}>{rows.length + i + 1}</span>
            <span>0x····…····</span>
            <span className={s.dots} />
            <span>—</span>
          </li>
        ))}
        {extra && (
          <li className={s.boardRow} data-me="true">
            <span className={s.boardRank}>{myRank!.rank}</span>
            <span>
              {short(me!)}
              <span className={s.boardYou}>you</span>
            </span>
            <span className={s.dots} aria-hidden />
            <span>{fmt(myRank!.points)}</span>
          </li>
        )}
      </ol>
      <p className={s.boardFoot}>Ranked by points earned this season. Games don’t count.</p>
    </section>
  );
}

/* ───────────────────────────── paytable ───────────────────────────── */

export function Paytable() {
  const n = Math.max(1, seasonAt());
  const r = POINTS_CONFIG.rewards;
  const w = POINTS_CONFIG.welcome;
  const rows: { k: string; n: string; v: string; off?: boolean }[] = [
    {
      k: "Daily ticket",
      n: "Every wallet in the season, once per UTC day",
      v: `${fmt(checkinReward(n, 1))} to ${fmt(checkinReward(n, 99))}`,
    },
    {
      k: "X post",
      n: `Holders, about Simp Cult, ${r.xPost.dailyCap} a day`,
      v: fmt(scaledReward(r.xPost.reward, n)),
    },
    {
      k: "Simp post",
      n: `${MONAD_CARD_ENABLED ? "Monad Card holders and active" : "Active"} Monad users (${POINTS_CONFIG.tx.activeUser}+ txs)`,
      v: fmt(scaledReward(r.simpPost.reward, n)),
    },
    {
      k: "Alpha",
      n: "A human reviews it",
      v: `up to ${fmt(scaledReward(r.alpha.max, n))}`,
    },
    {
      k: "Telegram bound",
      n: "On every ticket, post and alpha",
      v: `${POINTS_CONFIG.telegramMultiplier}×`,
    },
    {
      k: "Welcome",
      n: `Once: holders after ${w.holdMinutes} min holding, community wallets right away`,
      v: `${fmt(w.holder)} / ${fmt(w.community)}`,
    },
    { k: "Holding", n: "NFT-days, paid once at season end", v: "21% pool" },
    {
      k: "Daily pool",
      n: "Each day’s budget, shared by that day’s simps at 00:00 UTC",
      v: `max ${Math.round(POINTS_CONFIG.pace.walletCapShare * 100)}% each`,
    },
    {
      k: "Season post",
      n: "Last 48h: posters split the season pot, plus any unspent daily budget",
      v: "90% of pool",
    },
    { k: "The machine", n: "Spend them on the slot", v: "feed it" },
  ];
  return (
    <section className={cx(s.paper, s.paytable)} aria-labelledby="pay-title">
      <h2 id="pay-title" className={s.payTitle}>
        How the machine pays
      </h2>
      <p
        className={s.tag}
        style={{
          textAlign: "center",
          marginTop: 6,
          color: "var(--paper-ink-2)",
        }}
      >
        Season {n} weights. Each day, most of it is paid as a share of the daily pool.
      </p>
      <ul className={s.payRows}>
        {rows.map((x) => (
          <li key={x.k} className={s.payRow} data-off={x.off}>
            <span>
              {x.k === "The machine" ? (
                <Link href="/games/slot" style={{ color: "inherit" }}>
                  {x.k}
                </Link>
              ) : (
                x.k
              )}
              <small>{x.n}</small>
            </span>
            <span className={s.dots} aria-hidden />
            <span>{x.v}</span>
          </li>
        ))}
      </ul>
      <p className={s.payFine}>
        Each season the machine pays out half of what’s left and every rate halves with it. In the active and community
        pools, 10% pays as you go, paced over the season: every day gets an even slice, a little pays the moment you act
        and the rest is shared at 00:00 UTC by everyone who showed up that day, so quiet days pay more each. No wallet
        takes more than {Math.round(POINTS_CONFIG.pace.walletCapShare * 100)}% of a day’s pool; anything left rolls into
        the days after, and whatever is still unspent at season end goes to the season pot. The other 90% is split at
        season end, by points earned, among the wallets that post in the last 48 hours. Holders split the holding pool
        by NFT-days, if they hold through all 5 surprise snapshots and have made a Monad transaction. When a season
        closes, what you earned settles onchain as soulbound XP: yours, non-transferable.
      </p>
    </section>
  );
}

/* ───────────────────────────── states ───────────────────────────── */

export function WarmingUp() {
  return (
    <section className={cx(s.velvet, s.out)} aria-live="polite">
      <p className="t-eyebrow">Notice</p>
      <p className={s.tube}>The machine is warming up</p>
      <p className={s.outText}>
        The points desk isn’t plugged in yet, so tickets and slips are closed for a moment. Nothing’s lost and nothing’s
        late. Pour a drink, come back soon.
      </p>
    </section>
  );
}

export function Printing({ label = "Printing your ticket" }: { label?: string }) {
  return (
    <div className={s.rowA} aria-busy="true" aria-live="polite">
      <section className={s.plaque} style={{ minHeight: 260 }}>
        <p className="t-eyebrow">Your stack</p>
        <p className={s.bignumBlank}>Counting your stack…</p>
      </section>
      <div className={cx(s.paper, s.printing)}>
        <span>{label}…</span>
        <span className={s.printingLine} style={{ width: "86%" }} />
        <span className={s.printingLine} style={{ width: "64%" }} />
        <span className={s.printingLine} style={{ width: "72%" }} />
      </div>
    </div>
  );
}

export function Jammed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className={cx(s.paper, s.slip)} style={{ maxWidth: 560 }} role="alert">
      <p className={s.admit} style={{ fontSize: 32 }}>
        The printer jammed
      </p>
      <p className={s.ticketNote}>{message}</p>
      <div>
        <button className="btn btn-ghost btn-on-paper" onClick={onRetry}>
          try again
        </button>
      </div>
      <span className={s.stamp} style={{ top: 18, bottom: "auto" }} aria-hidden>
        <span className={s.stampBig}>jammed</span>
      </span>
    </section>
  );
}
