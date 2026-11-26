"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WalletButton } from "@/components/wallet/WalletButton";
import { toast } from "@/components/Toast";
import { useSession } from "@/lib/useSession";
import { useMounted } from "@/lib/useMounted";
import { short } from "@/lib/config";
import { POOLS, seasonAt, type PoolId } from "@/lib/points/config";
import {
  ApiError,
  api,
  fmt,
  isWarming,
  KIND_LABEL,
  POOL_LABEL,
  post,
  retryPolicy,
  slipNo,
  timeAgo,
  useNow,
  type Submission,
  type SubmissionKind,
} from "../lib";
import { fixtureSession, useFixture } from "../fixtures";
import { WarmingUp } from "../parts";
import s from "../portal.module.css";

type Queue = {
  pending: Submission[];
  reviewed: Submission[];
  rewards: Record<SubmissionKind, { default: number; min: number; max: number }>;
};

type Stats = {
  overview: {
    season: number;
    pools: { pool: PoolId; budget: number; emitted: number }[];
    house: { out: number; in: number };
    simps: number;
  };
  seasonBudget: number;
  holdingRatePerNftPerDay: number;
  lastHoldingRun: null | { day: string; owners: number; tokensPaid: number; pointsPaid: number; errors: string[] };
  persistent: boolean;
};

type Settlement = { season: number; root: string; total: number; count: number; frozenAt: number; entries: [string, number][] };

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function AdminQueue() {
  const mounted = useMounted();
  const fx = useFixture();
  const real = useSession();
  const address = fx ? fixtureSession(fx).address : (real.session?.address ?? null);
  const queue = useQuery({
    queryKey: ["admin", "queue", fx],
    queryFn: () => api<Queue>("/api/admin/points/queue"),
    enabled: mounted && !!address,
    retry: retryPolicy,
  });
  const forbidden = queue.error instanceof ApiError && (queue.error.status === 403 || queue.error.status === 401);

  return (
    <div className={s.desk}>
      <header className={s.mast}>
        <div>
          <span className={s.label}>back office</span>
          <h1 className={s.mastTitle}>
            the <em>pit boss</em>
          </h1>
          <p className={s.mastLead}>approve slips, hand out bonuses, run holding, freeze a season for settlement.</p>
        </div>
        <Link className={s.brass} href={`/portal${fx ? `?fixture=${fx}` : ""}`}>
          ← back to the desk
        </Link>
      </header>

      {!mounted ? null : isWarming(queue.error) ? (
        <WarmingUp />
      ) : !address ? (
        <section className={s.velvet}>
          <p className={s.outText} style={{ margin: "0 0 16px" }}>
            connect and sign in with an admin wallet.
          </p>
          <WalletButton variant="quiet" />
        </section>
      ) : forbidden ? (
        <section className={s.velvet}>
          <p className={s.outText} style={{ margin: 0 }}>
            {(queue.error as ApiError).code === "siwe_required"
              ? "admin needs a signature sign-in. sign out, then verify by signing."
              : `${short(address)} isn't on the admin list (POINTS_ADMINS).`}
          </p>
        </section>
      ) : queue.isLoading ? (
        <section className={cx(s.paper, s.printing)} aria-busy="true">
          <span>pulling the pile…</span>
          <span className={s.printingLine} style={{ width: "80%" }} />
          <span className={s.printingLine} style={{ width: "60%" }} />
        </section>
      ) : queue.data ? (
        <div className={s.adminGrid}>
          <StatsPanel fx={fx} />
          <Pending q={queue.data} />
          <div className={cx(s.adminGrid, s.adminTwo)}>
            <GrantForm />
            <SettlePanel fx={fx} />
          </div>
          <Reviewed rows={queue.data.reviewed} />
        </div>
      ) : (
        <section className={s.velvet} role="alert">
          <p className={s.outText} style={{ margin: 0 }}>
            {(queue.error as Error)?.message}
          </p>
        </section>
      )}
    </div>
  );
}

function StatsPanel({ fx }: { fx: string | null }) {
  const qc = useQueryClient();
  const stats = useQuery({ queryKey: ["admin", "stats", fx], queryFn: () => api<Stats>("/api/admin/points/stats"), retry: retryPolicy });
  const run = useMutation({
    mutationFn: () => post<{ tokensPaid: number; pointsPaid: number; errors: string[] }>("/api/admin/points/holding", {}),
    onSuccess: (r) => {
      toast.ok("holding run done", `${r.tokensPaid} simps paid · ${fmt(r.pointsPaid)} pts${r.errors.length ? ` · ${r.errors.length} errors` : ""}`);
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
    onError: (e) => toast.bad("holding run failed", (e as Error).message),
  });
  const d = stats.data;
  const stat = (k: string, v: string) => (
    <div key={k}>
      <div className={s.engravedK}>{k}</div>
      <div className={s.engravedV}>{v}</div>
    </div>
  );
  return (
    <section className={s.velvet}>
      <div className={s.panelHead}>
        <h2 className={s.panelTitle}>
          season <em>{d?.overview.season ?? "—"}</em>
        </h2>
        <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          {d && !d.persistent && <span className={s.caps} style={{ color: "var(--d-bad)" }}>in-memory store · set UPSTASH_*</span>}
          <button className={s.brass} disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <span className={s.spin} aria-hidden /> : null} run holding now
          </button>
        </span>
      </div>
      {d && (
        <div className={s.statGrid}>
          {d.overview.pools.map((p) => stat(POOL_LABEL[p.pool], `${fmt(p.emitted)} / ${fmt(p.budget)}`))}
          {stat("earners", fmt(d.overview.simps))}
          {stat("holding / simp / day", fmt(d.holdingRatePerNftPerDay))}
          {stat("games in / out", `${fmt(d.overview.house.in)} / ${fmt(d.overview.house.out)}`)}
          {stat(
            "last holding run",
            d.lastHoldingRun ? `${d.lastHoldingRun.tokensPaid} simps · ${fmt(d.lastHoldingRun.pointsPaid)}` : "not today",
          )}
        </div>
      )}
    </section>
  );
}

function Pending({ q }: { q: Queue }) {
  const now = useNow(30_000);
  return (
    <section className={s.velvet}>
      <div className={s.panelHead}>
        <h2 className={s.panelTitle}>
          the <em>pile</em>
        </h2>
        <span className={cx(s.caps, s.mute)}>{q.pending.length} waiting</span>
      </div>
      {q.pending.length === 0 ? (
        <p className={s.boardEmpty}>pile&apos;s empty. go touch grass.</p>
      ) : (
        <ul className={s.queue}>
          {q.pending.map((x) => (
            <PendingSlip key={x.id} sub={x} bounds={q.rewards[x.kind]} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PendingSlip({
  sub,
  bounds,
  now,
}: {
  sub: Submission;
  bounds: { default: number; min: number; max: number };
  now: number | null;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(String(bounds.default));
  const [note, setNote] = useState("");
  const review = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      post("/api/admin/points/review", {
        id: sub.id,
        action,
        note: note || undefined,
        ...(action === "approve" ? { amount: Number(amount) } : {}),
      }),
    onSuccess: (_, action) => {
      toast.ok(action === "approve" ? "paid" : "voided");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => toast.bad("review failed", (e as Error).message),
  });

  return (
    <li className={cx(s.paper, s.queueSlip)}>
      <div className={s.printedHead} style={{ margin: 0, flexWrap: "wrap" }}>
        <span>
          {KIND_LABEL[sub.kind]} · slip no. {slipNo(sub.id)}
        </span>
        <span>
          {short(sub.address)} · {now !== null ? timeAgo(sub.createdAt, now) : ""}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {sub.handle && <span className={s.mono} style={{ fontSize: 13 }}>@{sub.handle}</span>}
        {sub.handle && !sub.handleVerified && (
          <span className={s.flag} data-tone="warn" title="this wallet never proved it owns the handle">
            handle unverified
          </span>
        )}
        {sub.check && (
          <span className={s.flag} data-tone={!sub.check.reachable ? "warn" : sub.check.keyword ? "ok" : "bad"}>
            {!sub.check.reachable ? "x didn't answer" : `by @${sub.check.author} · ${sub.check.keyword ? "keyword ✓" : "no keyword"}`}
          </span>
        )}
      </div>
      <div className={s.slipBlurb} style={{ overflowWrap: "anywhere" }}>
        {sub.url ? (
          <a href={sub.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
            {sub.url}
          </a>
        ) : (
          <>
            <strong>{sub.title}</strong>
            {sub.note && <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{sub.note}</p>}
            {(sub.proof ?? []).map((p) => (
              <div key={p}>
                <a href={p} target="_blank" rel="noreferrer nofollow" style={{ color: "inherit" }}>
                  {p}
                </a>
              </div>
            ))}
          </>
        )}
      </div>
      <div className={s.inline}>
        <label className={s.srOnly} htmlFor={`amt-${sub.id}`}>
          reward
        </label>
        <input
          id={`amt-${sub.id}`}
          className={s.field}
          style={{ flex: "0 1 130px" }}
          type="number"
          inputMode="numeric"
          min={bounds.min}
          max={bounds.max}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <label className={s.srOnly} htmlFor={`note-${sub.id}`}>
          note to the simp
        </label>
        <input
          id={`note-${sub.id}`}
          className={s.field}
          placeholder="note (optional, they see it)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className={s.brass} disabled={review.isPending} onClick={() => review.mutate("approve")}>
          pay
        </button>
        <button className={cx(s.textBtn, s.rejectBtn)} disabled={review.isPending} onClick={() => review.mutate("reject")}>
          void
        </button>
      </div>
      <span className={s.slipHint}>
        range {fmt(bounds.min)}–{fmt(bounds.max)}
      </span>
    </li>
  );
}

function newRef() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
}

function GrantForm() {
  const qc = useQueryClient();
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [pool, setPool] = useState<PoolId>("active");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"grant" | "revoke">("grant");
  const [refId, setRefId] = useState(newRef);
  const m = useMutation({
    mutationFn: () => post<{ balance: number }>("/api/admin/points/grant", { address, amount: Number(amount), pool, note, mode, refId }),
    onSuccess: (r) => {
      toast.ok(mode === "grant" ? "granted" : "revoked", `new balance ${fmt(r.balance)}`);
      setAmount("");
      setNote("");
      setRefId(newRef());
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => toast.bad("failed", (e as Error).message),
  });
  return (
    <form
      className={cx(s.paper, s.slip)}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <div className={s.member}>
        <span className={s.payTitle} style={{ fontSize: 26 }}>
          grant / revoke
        </span>
        <span className={s.rollSwitch} role="tablist" style={{ margin: 0 }}>
          {(["grant", "revoke"] as const).map((x) => (
            <button type="button" role="tab" key={x} aria-selected={mode === x} onClick={() => setMode(x)}>
              {x}
            </button>
          ))}
        </span>
      </div>
      <div>
        <label className={s.slipLabel} htmlFor="g-addr">
          wallet
        </label>
        <input id="g-addr" className={s.field} placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" />
      </div>
      <div className={s.inline}>
        <div style={{ flex: "1 1 140px" }}>
          <label className={s.slipLabel} htmlFor="g-amt">
            amount
          </label>
          <input id="g-amt" className={s.field} type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <label className={s.slipLabel} htmlFor="g-pool">
            pool
          </label>
          <select id="g-pool" className={cx(s.field, s.selectField)} value={pool} onChange={(e) => setPool(e.target.value as PoolId)}>
            {POOLS.map((p) => (
              <option key={p} value={p}>
                {POOL_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={s.slipLabel} htmlFor="g-note">
          note (shows in their ledger)
        </label>
        <input id="g-note" className={s.field} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className={s.slipFoot}>
        <span className={s.slipHint}>grants come out of the season pool; revokes put points back.</span>
        <button className={cx(s.brass, mode === "revoke" && s.rejectBtn)} disabled={m.isPending || !address || !amount || note.length < 3}>
          {mode}
        </button>
      </div>
    </form>
  );
}

function SettlePanel({ fx }: { fx: string | null }) {
  const current = seasonAt();
  const [season, setSeason] = useState(String(Math.max(1, current - 1)));
  const [force, setForce] = useState(false);
  const qc = useQueryClient();
  const snap = useQuery({
    queryKey: ["admin", "settle", season, fx],
    queryFn: () => api<{ settlement: Settlement | null }>(`/api/admin/points/settle?season=${Number(season)}`),
    enabled: Number(season) >= 1,
    retry: retryPolicy,
  });
  const freeze = useMutation({
    mutationFn: () => post<{ settlement: Settlement }>("/api/admin/points/settle", { season: Number(season), force }),
    onSuccess: () => {
      toast.ok("season frozen");
      qc.invalidateQueries({ queryKey: ["admin", "settle"] });
    },
    onError: (e) => toast.bad("freeze failed", (e as Error).message),
  });
  const st = snap.data?.settlement;
  const download = () => {
    if (!st) return;
    const blob = new Blob([JSON.stringify(st, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `simp-xp-season-${st.season}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <section className={s.velvet}>
      <h2 className={s.panelTitle}>
        settle a <em>season</em>
      </h2>
      <p className={s.outText} style={{ margin: "10px 0 0", fontSize: 14 }}>
        freezes season-earned points into a merkle root for the soulbound xp contract. one way: a frozen season never changes.
      </p>
      <div className={s.inline} style={{ marginTop: 16 }}>
        <label className={s.srOnly} htmlFor="settle-season">
          season
        </label>
        <input
          id="settle-season"
          className={s.field}
          style={{ flex: "0 1 100px", color: "var(--d-gold-hi)", borderBottomColor: "var(--d-gold-lo)" }}
          type="number"
          min={1}
          value={season}
          onChange={(e) => setSeason(e.target.value)}
        />
        <button className={s.brass} disabled={!!st || freeze.isPending || Number(season) < 1} onClick={() => freeze.mutate()}>
          freeze
        </button>
      </div>
      {Number(season) >= current && !st && (
        <label className={s.under} style={{ display: "flex", gap: 8, marginTop: 12, color: "var(--d-bad)" }}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> season still running, freeze anyway
        </label>
      )}
      {st ? (
        <div style={{ marginTop: 16 }}>
          <div className={s.engravedK}>
            {fmt(st.count)} simps · {fmt(st.total)} xp
          </div>
          <p className={s.mono} style={{ margin: "8px 0", fontSize: 12, overflowWrap: "anywhere", color: "var(--d-gold-hi)" }}>
            {st.root}
          </p>
          <button className={s.textBtn} onClick={download}>
            download rows
          </button>
          <p className={s.under} style={{ margin: "8px 0 0" }}>
            onchain: setSeasonRoot({st.season}, root, {st.total})
          </p>
        </div>
      ) : (
        <p className={s.under} style={{ margin: "14px 0 0" }}>
          not frozen yet.
        </p>
      )}
    </section>
  );
}

function Reviewed({ rows }: { rows: Submission[] }) {
  const now = useNow(30_000);
  if (!rows.length) return null;
  return (
    <section className={cx(s.paper, s.roll)}>
      <div className={s.rollHead}>
        <strong>recently reviewed</strong>
      </div>
      <hr className={s.rule} />
      <ul className={s.lines}>
        {rows.map((x) => (
          <li key={x.id} className={s.line}>
            <span className={s.lineWhen}>{now !== null && x.reviewedAt ? timeAgo(x.reviewedAt, now) : ""}</span>
            <span className={s.lineWhat}>
              {KIND_LABEL[x.kind]} · {short(x.address)} · {x.url ?? x.title} · {x.auto ? "auto" : x.reviewedBy ? short(x.reviewedBy) : ""}
            </span>
            <span className={cx(s.lineAmt, s.lineTag)} data-s={x.status}>
              {x.status === "approved" ? `+${fmt(x.reward ?? 0)}` : "void"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
