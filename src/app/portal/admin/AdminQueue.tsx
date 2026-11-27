"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WalletButton } from "@/components/wallet/WalletButton";
import { toast } from "@/components/Toast";
import { useSession } from "@/lib/useSession";
import { useMounted } from "@/lib/useMounted";
import { short } from "@/lib/config";
import { seasonAt, type BucketId, type PoolId } from "@/lib/points/config";
import {
  ApiError,
  api,
  BUCKET_LABEL,
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
  lastHoldingRun: null | { day: string; owners: number; tokensCounted: number; snapshotsTaken: number; errors: string[] };
  snapshots: { index: number; scheduledAt: number; takenAt: number; tokens: number; missing: number }[];
  persistent: boolean;
};

type Drop = { pot: number; paid: number; burnt: number; recipients: number; wallets: number; instantLeftover?: number };
type Settlement = {
  season: number;
  root: string;
  total: number;
  count: number;
  frozenAt: number;
  entries: [string, number][];
  drops?: Record<BucketId, Drop>;
  burnt?: number;
  posters?: number;
};
type Payout = { credited: number; total: number; done: boolean };

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
          <p className="t-eyebrow">Back office</p>
          <h1 className={s.mastTitle}>The pit boss</h1>
          <p className={s.mastLead}>Approve slips, hand out bonuses, count holding, close a season for settlement.</p>
        </div>
        <Link className="btn btn-ghost" href={`/portal${fx ? `?fixture=${fx}` : ""}`}>
          back to the desk
        </Link>
      </header>

      {!mounted ? null : isWarming(queue.error) ? (
        <WarmingUp />
      ) : !address ? (
        <section className={s.velvet}>
          <p className={s.outText} style={{ margin: "0 0 16px" }}>
            Connect and sign in with an admin wallet.
          </p>
          <WalletButton variant="quiet" />
        </section>
      ) : forbidden ? (
        <section className={s.velvet}>
          <p className={s.outText} style={{ margin: 0 }}>
            {(queue.error as ApiError).code === "siwe_required"
              ? "Admin needs a signature sign-in. Sign out, then verify by signing."
              : `${short(address)} isn’t on the admin list (POINTS_ADMINS).`}
          </p>
        </section>
      ) : queue.isLoading ? (
        <section className={cx(s.paper, s.printing)} aria-busy="true">
          <span>Pulling the pile…</span>
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
    mutationFn: () => post<{ tokensCounted: number; snapshotsTaken: number; errors: string[] }>("/api/admin/points/holding", {}),
    onSuccess: (r) => {
      toast.ok(
        "holding counted",
        `${r.tokensCounted} nft-days added${r.snapshotsTaken ? ` · ${r.snapshotsTaken} snapshot taken` : ""}${r.errors.length ? ` · ${r.errors.length} errors` : ""}`,
      );
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
          Season {d?.overview.season ?? "—"}
        </h2>
        <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          {d && !d.persistent && (
            <span className="t-label" style={{ color: "var(--d-bad)" }}>
              in-memory store: set UPSTASH_* to keep data
            </span>
          )}
          <button className="btn btn-ghost" disabled={run.isPending} aria-busy={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <span className={s.spin} aria-hidden /> : null} count holding now
          </button>
        </span>
      </div>
      {d && (
        <div className={s.statGrid}>
          {d.overview.pools.map((p) => stat(POOL_LABEL[p.pool], `${fmt(p.emitted)} / ${fmt(p.budget)}`))}
          {stat("earners", fmt(d.overview.simps))}
          {stat(
            "snapshots taken",
            `${d.snapshots.length} / 5${d.snapshots.length ? ` · last ${new Date(d.snapshots[d.snapshots.length - 1].takenAt).toISOString().slice(5, 16).replace("T", " ")}` : ""}`,
          )}
          {stat("games in / out", `${fmt(d.overview.house.in)} / ${fmt(d.overview.house.out)}`)}
          {stat(
            "last holding run",
            d.lastHoldingRun ? `${d.lastHoldingRun.tokensCounted} nft-days` : "not today",
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
          The pile
        </h2>
        <span className="t-label">{q.pending.length} waiting</span>
      </div>
      {q.pending.length === 0 ? (
        <p className={s.boardEmpty}>Pile’s empty. Go touch grass.</p>
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
            {!sub.check.reachable ? "X didn’t answer" : `by @${sub.check.author} · ${sub.check.keyword ? "keyword ✓" : "no keyword"}`}
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
        <button className="btn btn-ghost btn-on-paper" disabled={review.isPending} onClick={() => review.mutate("approve")}>
          pay
        </button>
        <button className={cx(s.textBtn, s.rejectBtn)} disabled={review.isPending} onClick={() => review.mutate("reject")}>
          void
        </button>
      </div>
      <span className={s.slipHint}>
        range {fmt(bounds.min)}–{fmt(bounds.max)}
        {sub.kind === "alpha"
          ? ". The amount is a weight in today’s pool; the wallet’s day total is capped at 5% of the pool."
          : ""}
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
  const [bucket, setBucket] = useState<BucketId>("active");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"grant" | "revoke">("grant");
  const [refId, setRefId] = useState(newRef);
  const m = useMutation({
    mutationFn: () => post<{ balance: number }>("/api/admin/points/grant", { address, amount: Number(amount), bucket, note, mode, refId }),
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
          <select id="g-pool" className={cx(s.field, s.selectField)} value={bucket} onChange={(e) => setBucket(e.target.value as BucketId)}>
            {(["active", "card", "amu"] as const).map((b) => (
              <option key={b} value={b}>
                {BUCKET_LABEL[b]}
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
        <span className={s.slipHint}>grants come out of the pool’s 10% instant budget (no telegram bonus); revokes put points back.</span>
        <button
          className={cx("btn btn-ghost btn-on-paper", mode === "revoke" && s.rejectBtn)}
          disabled={m.isPending || !address || !amount || note.length < 3}
          aria-busy={m.isPending}
        >
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
    queryFn: () => api<{ settlement: Settlement | null; payout?: Payout | null }>(`/api/admin/points/settle?season=${Number(season)}`),
    enabled: Number(season) >= 1,
    retry: retryPolicy,
  });
  const freeze = useMutation({
    mutationFn: () => post<{ settlement: Settlement; payout: Payout }>("/api/admin/points/settle", { season: Number(season), force }),
    onSuccess: (r) => {
      toast.ok("season frozen", r.payout.done ? "season-end shares all credited" : `credited ${r.payout.credited} of ${r.payout.total}, press again`);
      qc.invalidateQueries({ queryKey: ["admin", "settle"] });
    },
    onError: (e) => toast.bad("freeze failed", (e as Error).message),
  });
  const st = snap.data?.settlement;
  const payout = snap.data?.payout;
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
        Settle a season
      </h2>
      <p className={s.outText} style={{ margin: "10px 0 0", fontSize: 14 }}>
        Computes the season-end shares (90% to final-48h posters, the rest burnt) and the holding drop, then freezes
        everything into a Merkle root for the soulbound XP contract and credits the shares. Review pending season posts
        first. One way: a frozen season never changes.
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
        <button
          className="btn btn-ghost"
          disabled={(!!st && !!payout?.done) || freeze.isPending || Number(season) < 1}
          aria-busy={freeze.isPending}
          onClick={() => freeze.mutate()}
        >
          {st ? "credit shares" : "close season"}
        </button>
      </div>
      {Number(season) >= current && !st && (
        <label className={s.under} style={{ display: "flex", gap: 8, marginTop: 12, color: "var(--d-bad)" }}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Season still running, freeze anyway (testing only: burns every 90% share whose season post isn’t in yet, and closes the season post)
        </label>
      )}
      {st ? (
        <div style={{ marginTop: 16 }}>
          <div className={s.engravedK}>
            {fmt(st.count)} simps · {fmt(st.total)} xp
            {st.burnt !== undefined ? ` · ${fmt(st.burnt)} burnt` : ""}
            {st.posters !== undefined ? ` · ${fmt(st.posters)} season posts` : ""}
            {payout ? ` · shares credited ${payout.credited}/${payout.total}` : ""}
          </div>
          {st.drops && (
            <ul className={s.under} style={{ margin: "8px 0 0", paddingLeft: 16 }}>
              {(Object.entries(st.drops) as [BucketId, Drop][]).map(([b, d]) => (
                <li key={b}>
                  {BUCKET_LABEL[b]}: pot {fmt(d.pot)}
                  {d.instantLeftover !== undefined ? ` (+${fmt(d.instantLeftover)} unspent daily)` : ""} · paid {fmt(d.paid)} to{" "}
                  {d.recipients}/{d.wallets} · burnt {fmt(d.burnt)}
                </li>
              ))}
            </ul>
          )}
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
          Not frozen yet.
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
