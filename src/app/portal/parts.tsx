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
  holdingRatePerNftPerDay,
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
        <span className={s.label}>the points desk</span>
        <h1 className={s.mastTitle}>
          simp <em>points</em>
        </h1>
        <p className={s.mastLead}>
          check in, post about the cult, bring alpha. every simp move stacks points, and every season the machine pays out
          half of what&apos;s left. forever.
        </p>
      </div>
      <div className={s.clock}>
        <span className={s.caps + " " + s.mute}>season {n}</span>
        <span className={s.clockTime} title={target ? new Date(target).toUTCString() : undefined}>
          {target !== null && now !== null ? `${live ? "closes in" : "opens in"} ${countdown(target - now)}` : "—"}
        </span>
      </div>
    </header>
  );
}

/* ───────────────────────────── balance plaque ───────────────────────────── */

export function Plaque({ me }: { me?: Me }) {
  return (
    <section className={s.plaque} aria-label="your balance">
      <div className={s.plaqueTop}>
        <span className={s.label}>your stack</span>
        <span className={cx(s.mono, s.mute)} style={{ fontSize: 12 }}>
          {me ? short(me.address) : "no wallet"}
        </span>
      </div>
      <p className={cx(s.bignum, !me && s.bignumBlank)}>
        {me ? fmt(me.balance) : "??,???"}
        <span className={s.bignumUnit}>pts</span>
      </p>
      <div className={s.engraved}>
        <div>
          <div className={s.engravedK}>earned this season</div>
          <div className={s.engravedV}>{me ? fmt(me.rank.points) : "—"}</div>
        </div>
        <div>
          <div className={s.engravedK}>rank</div>
          <div className={s.engravedV}>{me ? (me.rank.rank ? `#${me.rank.rank}` : "unranked") : "—"}</div>
        </div>
        <div>
          <div className={s.engravedK}>simps held</div>
          <div className={s.engravedV}>{me ? me.nfts : "—"}</div>
        </div>
      </div>
      <p className={s.wink}>points that might mean something someday.</p>
    </section>
  );
}

/* ───────────────────────────── the check-in ticket ───────────────────────────── */

export type TicketVariant = "live" | "signedout" | "signin" | "members" | "closed";

export function CheckinTicket({ variant, me, season }: { variant: TicketVariant; me?: Me; season: number }) {
  const qc = useQueryClient();
  const now = useNow();
  const [fresh, setFresh] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const sig = useVerifyBySignature();
  const punch = useMutation({
    mutationFn: () => post<{ amount: number; streak: number; balance: number }>("/api/points/checkin", {}),
    onSuccess: (d) => {
      setFresh(true);
      toast.ok(`+${fmt(d.amount)} points`, d.streak > 1 ? `day ${d.streak}. keep simping.` : "streak started. see you tomorrow.");
      qc.invalidateQueries({ queryKey: ["points"] });
    },
    onError: (e) => toast.bad("ticket didn't punch", (e as Error).message),
  });

  const c = me?.checkin;
  const punched = variant === "live" && !!c?.checkedInToday;
  const streak = c?.streak ?? 0;
  const holes = Math.min(streak, MAX_STREAK_DAYS);
  const todayPays = c ? (punched ? checkinReward(Math.max(1, season), streak) : c.nextReward) : checkinReward(Math.max(1, season), 1);
  const day = now !== null ? utcDay(now) : "";

  let note: ReactNode;
  if (variant === "signedout") note = "connect a wallet to get today's ticket. holders only, one per day.";
  else if (variant === "signin") note = "one free signature proves the wallet is yours. no transaction, can't move anything.";
  else if (variant === "members") note = "this wallet holds no simp cult nft. tickets are for holders.";
  else if (variant === "closed") note = "the doors aren't open yet. season 1 starts soon.";
  else if (punched)
    note = (
      <>
        punched. tomorrow pays <b>{fmt(c!.nextReward)}</b>
        {streak + 1 <= MAX_STREAK_DAYS ? "" : " (max streak)"}.
      </>
    );
  else
    note = (
      <>
        today pays <b>{fmt(todayPays)}</b>. streaks stack +10% a day, up to 2× on day {MAX_STREAK_DAYS}.
      </>
    );

  const stampFor =
    punched ? (
      <span className={s.stamp} data-fresh={fresh} aria-hidden>
        <small>paid</small>
        <span className={s.stampBig}>+{fmt(todayPays)}</span>
        <small>{day}</small>
      </span>
    ) : variant === "members" ? (
      <span className={s.stamp} aria-hidden>
        <span className={s.stampBig}>members</span>
        <small>only</small>
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
            <span>daily ticket</span>
            <span>{day || "—"}</span>
          </div>
          <div>
            <p className={s.admit}>admit one simp</p>
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
                ? `streak ${streak} day${streak === 1 ? "" : "s"}${streak >= MAX_STREAK_DAYS ? " · max bonus" : ""}`
                : `${MAX_STREAK_DAYS} punches to a 2× ticket`}
            </div>
          </div>
          {stampFor}
          {punched && <span className={s.srOnly}>checked in today, paid {fmt(todayPays)} points</span>}
        </div>
        <div className={s.ticketStub}>
          <span>no. {String(streak).padStart(4, "0")}</span>
        </div>
      </div>

      <div className={s.ctaRow}>
        {variant === "live" && !punched && (
          <button className={cx(s.neon, s.wide)} disabled={punch.isPending} onClick={() => punch.mutate()}>
            {punch.isPending ? <Spin /> : null} punch today&apos;s ticket
          </button>
        )}
        {variant === "live" && punched && (
          <span className={s.under}>next ticket in {now !== null ? countdown(nextUtcMidnight(now) - now) : "—"} · 00:00 utc</span>
        )}
        {variant === "signedout" && (
          <>
            <button className={cx(s.neon, s.wide)} onClick={() => setWalletOpen(true)}>
              connect wallet
            </button>
            <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
          </>
        )}
        {variant === "signin" && (
          <>
            <button
              className={s.neon}
              disabled={sig.isPending}
              onClick={() =>
                sig.mutate(undefined, {
                  onError: (e) => toast.bad("signature didn't go through", (e as Error).message.split("\n")[0]),
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
          <a className={s.brass} href={LINKS.opensea} target="_blank" rel="noreferrer">
            find a simp ↗
          </a>
        )}
        {variant === "closed" && <span className={s.under}>check back when the clock hits zero.</span>}
      </div>
    </section>
  );
}

/* ───────────────────────────── drop your slip ───────────────────────────── */

export function SlipDesk({ me, hot }: { me: Me; hot: boolean }) {
  const tabs: { id: SubmissionKind; label: string }[] = [
    { id: "x_post", label: "x post" },
    { id: "alpha", label: "alpha" },
    ...(MONAD_CARD_ENABLED ? [{ id: "simp_post" as const, label: "simp post" }] : []),
  ];
  const [tab, setTab] = useState<SubmissionKind>("x_post");
  const [last, setLast] = useState<Submission | null>(null);

  return (
    <section className={s.velvet} aria-labelledby="slip-title">
      <div className={s.panelHead}>
        <h2 id="slip-title" className={s.panelTitle}>
          drop your <em>slip</em>
        </h2>
        <span className={cx(s.caps, s.mute)}>{fmt(me.caps[tab] ?? 0)} left today</span>
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
    onError: (e) => toast.bad("couldn't save that handle", (e as Error).message),
  });
  const verify = useMutation({
    mutationFn: () => post("/api/points/x-handle", { url }),
    onSuccess: () => {
      toast.ok("handle verified", "your x posts now pay out on the spot.");
      setUrl("");
      refresh();
    },
    onError: (e) => toast.bad("couldn't verify", (e as Error).message),
  });

  if (me.x && !editing) {
    return (
      <div className={s.slipRow}>
        <div className={s.member}>
          <span>
            <span className={s.slipLabel}>member </span> @{me.x.handle}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            {me.x.verified ? <span className={s.verified}>✓ verified</span> : <span className={s.slipHint}>unverified</span>}
            <button type="button" className={s.textBtn} style={{ color: "inherit" }} onClick={() => setEditing(true)}>
              change
            </button>
          </span>
        </div>
        {!me.x.verified && me.x.code && (
          <div className={s.codeBox}>
            unverified posts wait for a human. to get paid on the spot, post{" "}
            <button
              type="button"
              className={s.code}
              title="copy"
              onClick={() => navigator.clipboard?.writeText(me.x!.code!).then(() => toast.info("copied", me.x!.code))}
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
                link to your verification post
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
              <button className={s.brass} disabled={!url.trim() || verify.isPending}>
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
        your x handle
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
        <button className={s.brass} disabled={!handle.trim() || claim.isPending}>
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
  kind: "x_post" | "simp_post";
  hot: boolean;
  onDone: (s: Submission) => void;
}) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const left = me.caps[kind];
  const eligible = kind === "x_post" ? me.holder : me.monadCard.holder;
  const r = POINTS_CONFIG.rewards;
  const m = useMutation({
    mutationFn: () => post<{ submission: Submission }>("/api/points/submit", { kind, url }),
    onSuccess: ({ submission }) => {
      setUrl("");
      onDone(submission);
      qc.invalidateQueries({ queryKey: ["points"] });
    },
    onError: (e) => toast.bad("slip bounced", (e as Error).message),
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
          ? `post about simp cult on x (say "simp cult" or tag @monadsimpcult), then drop the link. ${fmt(scaledReward(r.xPost.reward, Math.max(1, seasonAt())))} a post, ${r.xPost.dailyCap} a day.`
          : `monad card holders: any post with the word "simp" counts. ${r.simpPost.dailyCap} a day.`}
      </p>
      <div>
        <label className={s.slipLabel} htmlFor={`url-${kind}`}>
          post link
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
          {!eligible
            ? kind === "x_post"
              ? "x posts are for simp cult holders."
              : "simp posts are for monad card holders."
            : !me.x
              ? "add your handle above first."
              : left < 1
                ? "that's today's three. back after 00:00 utc."
                : me.x.verified
                  ? "verified handle: pays on the spot if x confirms it."
                  : "goes to the review pile until your handle is verified."}
        </span>
        <button className={hot ? s.neon : s.brass} disabled={!ready || !url.trim() || m.isPending}>
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
    onError: (e) => toast.bad("slip bounced", (e as Error).message),
  });
  const off = !me.holder || left < 1;
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
        found something the cult should know? built a tool, made art, ran a space? send it with proof. a human reads every
        slip and good alpha pays up to {fmt(max)}.
      </p>
      <div>
        <label className={s.slipLabel} htmlFor="alpha-title">
          what is it
        </label>
        <input id="alpha-title" className={s.field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={off} />
      </div>
      <div>
        <label className={s.slipLabel} htmlFor="alpha-note">
          details (optional)
        </label>
        <textarea id="alpha-note" className={s.field} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} disabled={off} />
      </div>
      <div>
        <label className={s.slipLabel} htmlFor="alpha-proof">
          proof links, up to 3
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
          {!me.holder ? "alpha slips are for simp cult holders." : left < 1 ? "three a day. back after 00:00 utc." : "reviewed weekly."}
        </span>
        <button className={hot ? s.neon : s.brass} disabled={off || title.trim().length < 4 || !proof.trim() || m.isPending}>
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
      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {sub.url ? sub.url.replace(/^https:\/\//, "") : sub.title}
      </div>
      <span className={s.printedStatus} data-tone={paid ? "ok" : undefined}>
        {paid ? `paid +${fmt(sub.reward ?? 0)}` : "in review"}
      </span>
      <div style={{ marginTop: 8, fontSize: 11.5, opacity: 0.7 }}>
        {paid ? "x confirmed it. points are in your stack." : "a human checks the pile. points land once it's approved."}
      </div>
    </div>
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
          slips{pending ? ` · ${pending}` : ""}
        </button>
      </div>
      <hr className={s.rule} />
      {view === "ledger" ? (
        ledger.isLoading ? (
          <p className={s.empty}>printing…</p>
        ) : ledger.error ? (
          <p className={s.empty}>the printer jammed. reload in a sec.</p>
        ) : rows.length === 0 ? (
          <p className={s.empty}>nothing printed yet. today&apos;s ticket is the easiest first line.</p>
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
        <p className={s.empty}>no slips yet. drop one on the left.</p>
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
  monad: { n: 1, color: "#4a1236" },
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
    <svg className={s.dial} viewBox="0 0 300 168" role="img" aria-label={progress === null ? "season clock" : `season ${Math.round(p * 100)}% done`}>
      <defs>
        <linearGradient id="brass" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f6dc95" />
          <stop offset="0.45" stopColor="#d9a845" />
          <stop offset="1" stopColor="#7a5418" />
        </linearGradient>
      </defs>
      <path d={`M ${cxp - r} ${cy} A ${r} ${r} 0 0 1 ${cxp + r} ${cy}`} fill="none" stroke="#7a5418" strokeWidth="2" opacity="0.6" />
      {p > 0 && (
        <path d={`M ${cxp - r} ${cy} A ${r} ${r} 0 0 1 ${ex} ${ey}`} fill="none" stroke="url(#brass)" strokeWidth="4" strokeLinecap="round" />
      )}
      {Array.from({ length: days + 1 }, (_, i) => {
        const major = i % 7 === 0;
        const [x1, y1] = pt(i / days, r + 6);
        const [x2, y2] = pt(i / days, r + (major ? 18 : 11));
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={major ? "#d9a845" : "#7a5418"} strokeWidth={major ? 2 : 1} />;
      })}
      {Array.from({ length: 7 }, (_, w) => {
        const [x, y] = pt(w / 6, r - 14);
        return (
          <text key={w} x={x} y={y + 4} textAnchor="middle" fontSize="10" fill="#7a5418" fontFamily="var(--font-mono, monospace)">
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
  const dayOf = progress !== null ? Math.min(POINTS_CONFIG.season.lengthDays, Math.floor(progress * POINTS_CONFIG.season.lengthDays) + 1) : null;

  return (
    <section className={s.velvet} aria-labelledby="season-title">
      <div className={s.panelHead}>
        <h2 id="season-title" className={s.panelTitle}>
          season <em>{n}</em>
        </h2>
        <span className={cx(s.caps, s.mute)}>{info ? `${fmt(info.simps)} simps earning` : warming ? "warming up" : "—"}</span>
      </div>
      <div className={s.dialWrap}>
        <Dial progress={progress} />
        <div className={s.dialLabel}>
          {dayOf ? `day ${dayOf} of ${POINTS_CONFIG.season.lengthDays}` : info && !info.live ? "not started" : "six weeks a season"}
        </div>
      </div>
      <div className={s.onTable}>
        <span className={s.caps + " " + s.mute}>on the table this season</span>
        <span className={s.onTableNum}>{fmt(total)}</span>
      </div>
      <ul className={s.rack}>
        {pools.map((p) => {
          const chip = CHIPS[p.pool];
          const closed = p.pool === "monad" && !MONAD_CARD_ENABLED;
          const taken = p.emitted > 0 && p.budget > 0 ? Math.floor((p.emitted / p.budget) * chip.n) : 0;
          const share = POINTS_CONFIG.poolBps[p.pool] / 100;
          return (
            <li key={p.pool} className={s.rackRow} style={closed ? { opacity: 0.55 } : undefined}>
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
                  {share}% ·{" "}
                  {closed ? "opens when the card is confirmed" : p.emitted >= 0 ? `${fmt(p.emitted)} paid out` : "paid out: —"}
                </div>
              </div>
              <div className={s.rackAmt}>
                {fmt(p.budget)}
                <small>{p.pool === "active" ? "tasks" : p.pool === "holding" ? "per simp held" : "simp posts"}</small>
              </div>
            </li>
          );
        })}
      </ul>
      <div className={s.next}>
        <span>next season: half.</span>
        <b>{fmt(nextTotal)}</b>
      </div>
    </section>
  );
}

/* ───────────────────────────── engraved board ───────────────────────────── */

export function Board({ me, myRank, warming }: { me?: string | null; myRank?: Me["rank"]; warming?: boolean }) {
  const lb = useQuery({
    queryKey: ["points", "leaderboard"],
    queryFn: () => api<{ season: number; rows: LeaderRow[] }>("/api/points/leaderboard"),
    refetchInterval: 60_000,
    retry: retryPolicy,
    enabled: !warming,
  });
  const rows = lb.data?.rows.slice(0, 12) ?? [];
  const mine = me?.toLowerCase();
  const meOnBoard = rows.some((r) => r.address === mine);

  return (
    <section className={s.board} aria-labelledby="board-title">
      <div className={s.boardTitle}>
        <span className={s.label} id="board-title">
          top simps · season {lb.data?.season ?? Math.max(1, seasonAt())}
        </span>
      </div>
      {warming ? (
        <p className={s.boardEmpty}>the board is still being engraved.</p>
      ) : lb.isLoading ? (
        <p className={s.boardEmpty}>polishing the brass…</p>
      ) : lb.error ? (
        <p className={s.boardEmpty}>couldn&apos;t read the board. it&apos;ll be back.</p>
      ) : rows.length === 0 ? (
        <p className={s.boardEmpty}>nobody on the board yet. first simp gets engraved first.</p>
      ) : (
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
          {!meOnBoard && myRank?.rank && me && (
            <li className={s.boardRow} data-me="true">
              <span className={s.boardRank}>{myRank.rank}</span>
              <span>
                {short(me)}
                <span className={s.boardYou}>you</span>
              </span>
              <span className={s.dots} aria-hidden />
              <span>{fmt(myRank.points)}</span>
            </li>
          )}
        </ol>
      )}
      <p className={s.under} style={{ margin: "16px 0 0", textAlign: "center" }}>
        ranked by points earned this season. games don&apos;t count.
      </p>
    </section>
  );
}

/* ───────────────────────────── paytable ───────────────────────────── */

export function Paytable() {
  const n = Math.max(1, seasonAt());
  const r = POINTS_CONFIG.rewards;
  const rows: { k: string; n: string; v: string; off?: boolean }[] = [
    { k: "daily ticket", n: "holders, once per utc day", v: `${fmt(checkinReward(n, 1))} → ${fmt(checkinReward(n, 99))}` },
    { k: "x post", n: `about simp cult · ${r.xPost.dailyCap} a day`, v: fmt(scaledReward(r.xPost.reward, n)) },
    { k: "alpha", n: "a human reviews it", v: `up to ${fmt(scaledReward(r.alpha.max, n))}` },
    { k: "holding", n: "per simp, per day, automatic", v: fmt(holdingRatePerNftPerDay(n)) },
    {
      k: "simp post",
      n: "monad card holders",
      v: MONAD_CARD_ENABLED ? fmt(scaledReward(r.simpPost.reward, n)) : "soon",
      off: !MONAD_CARD_ENABLED,
    },
    { k: "the machine", n: "spend them on the slot", v: "feed it" },
  ];
  return (
    <section className={cx(s.paper, s.paytable)} aria-labelledby="pay-title">
      <h2 id="pay-title" className={s.payTitle}>
        how the machine pays
      </h2>
      <p className={s.caps} style={{ textAlign: "center", marginTop: 6, color: "rgba(43,19,32,.6)" }}>
        season {n} rates
      </p>
      <ul className={s.payRows}>
        {rows.map((x) => (
          <li key={x.k} className={s.payRow} data-off={x.off}>
            <span>
              {x.k === "the machine" ? (
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
        each season the machine pays out half of what&apos;s left and every rate halves with it. when a season closes, what you
        earned settles onchain as soulbound xp: yours, non-transferable.
      </p>
    </section>
  );
}

/* ───────────────────────────── states ───────────────────────────── */

export function WarmingUp() {
  return (
    <section className={cx(s.velvet, s.out)} aria-live="polite">
      <span className={s.label}>notice</span>
      <p className={s.tube}>the machine is warming up</p>
      <p className={s.outText}>
        the points desk isn&apos;t plugged in yet, so tickets and slips are closed for a moment. nothing&apos;s lost and
        nothing&apos;s late. pour a drink, come back soon.
      </p>
    </section>
  );
}

export function Printing({ label = "printing your ticket" }: { label?: string }) {
  return (
    <div className={s.rowA} aria-busy="true" aria-live="polite">
      <section className={s.plaque} style={{ minHeight: 260 }}>
        <span className={s.label}>your stack</span>
        <p className={cx(s.bignum, s.bignumBlank)}>…</p>
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
        the printer jammed
      </p>
      <p className={s.ticketNote}>{message}</p>
      <div>
        <button className={s.brass} onClick={onRetry}>
          try again
        </button>
      </div>
      <span className={s.stamp} style={{ top: 18, bottom: "auto" }} aria-hidden>
        <span className={s.stampBig}>jammed</span>
      </span>
    </section>
  );
}
