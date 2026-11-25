"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { WalletButton } from "@/components/wallet/WalletButton";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/Toast";
import { useSession } from "@/lib/useSession";
import { useMounted } from "@/lib/useMounted";
import { short } from "@/lib/config";
import { POOLS, seasonAt, type PoolId } from "@/lib/points/config";
import { ApiError, api, compact, fmt, KIND_LABEL, POOL_LABEL, post, timeAgo, useNow, type Submission, type SubmissionKind } from "../lib";

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

export function AdminQueue() {
  const mounted = useMounted();
  const { session } = useSession();
  const queue = useQuery({
    queryKey: ["admin", "queue"],
    queryFn: () => api<Queue>("/api/admin/points/queue"),
    enabled: mounted && !!session,
    retry: false,
  });

  const forbidden = queue.error instanceof ApiError && (queue.error.status === 403 || queue.error.status === 401);

  return (
    <>
      <PageHeader
        eyebrow="simp machine"
        title="admin queue"
        lead="approve posts and alpha, hand out bonuses, run holding, freeze seasons."
        aside={
          <Link className="btn btn-ghost btn-sm" href="/portal">
            ← portal
          </Link>
        }
      />
      {!mounted ? null : !session ? (
        <div className="glass mt-10 p-7">
          <p className="t-body text-dim">connect and sign in with an admin wallet.</p>
          <div className="mt-4">
            <WalletButton />
          </div>
        </div>
      ) : forbidden ? (
        <div className="glass mt-10 p-7">
          <p className="t-body text-dim">
            {short(session.address)} isn&apos;t on the admin list (<span className="mono">POINTS_ADMINS</span>).
          </p>
        </div>
      ) : queue.isLoading ? (
        <div className="glass mt-10 h-48 animate-pulse" />
      ) : queue.data ? (
        <div className="mt-10 grid gap-6">
          <StatsPanel />
          <Pending q={queue.data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <GrantForm />
            <SettlePanel />
          </div>
          <Reviewed rows={queue.data.reviewed} />
        </div>
      ) : (
        <div className="glass mt-10 p-7 text-sm text-bad">{(queue.error as Error)?.message}</div>
      )}
    </>
  );
}

function StatsPanel() {
  const qc = useQueryClient();
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: () => api<Stats>("/api/admin/points/stats") });
  const run = useMutation({
    mutationFn: () => post<{ tokensPaid: number; pointsPaid: number; errors: string[] }>("/api/admin/points/holding", {}),
    onSuccess: (r) => {
      toast.ok("holding run done", `${r.tokensPaid} simps paid · ${fmt(r.pointsPaid)} pts${r.errors.length ? ` · ${r.errors.length} errors` : ""}`);
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
    onError: (e) => toast.bad("holding run failed", (e as Error).message),
  });
  const s = stats.data;
  return (
    <div className="glass p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="t-h2">season {s?.overview.season ?? "—"}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {s && !s.persistent && <span className="pill pill-bad">in-memory store — set UPSTASH_*</span>}
          <button className="btn btn-ghost btn-sm" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Icon name="spinner" className="h-4 w-4 animate-spin" /> : null} run holding now
          </button>
        </div>
      </div>
      {s && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {s.overview.pools.map((p) => (
            <Stat key={p.pool} k={POOL_LABEL[p.pool]} v={`${compact(p.emitted)} / ${compact(p.budget)}`} />
          ))}
          <Stat k="earners" v={fmt(s.overview.simps)} />
          <Stat k="holding / simp / day" v={fmt(s.holdingRatePerNftPerDay)} />
          <Stat k="games in / out" v={`${compact(s.overview.house.in)} / ${compact(s.overview.house.out)}`} />
          <Stat
            k="last holding run"
            v={s.lastHoldingRun ? `${s.lastHoldingRun.tokensPaid} simps · ${compact(s.lastHoldingRun.pointsPaid)}` : "not today"}
          />
        </div>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-[var(--r-md)] border border-line p-4">
      <p className="t-wide-sm text-mute">{k}</p>
      <p className="mt-2 text-text num">{v}</p>
    </div>
  );
}

function Pending({ q }: { q: Queue }) {
  const now = useNow(30_000);
  return (
    <div className="glass p-7">
      <h2 className="t-h2">pending · {q.pending.length}</h2>
      {q.pending.length === 0 ? (
        <p className="mt-4 text-sm text-mute">queue is clear.</p>
      ) : (
        <ul className="mt-5 grid gap-3">
          {q.pending.map((s) => (
            <PendingRow key={s.id} s={s} bounds={q.rewards[s.kind]} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PendingRow({
  s,
  bounds,
  now,
}: {
  s: Submission;
  bounds: { default: number; min: number; max: number };
  now: number | null;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(String(bounds.default));
  const [note, setNote] = useState("");
  const review = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      post("/api/admin/points/review", {
        id: s.id,
        action,
        note: note || undefined,
        ...(action === "approve" ? { amount: Number(amount) } : {}),
      }),
    onSuccess: (_, action) => {
      toast.ok(action === "approve" ? "approved" : "rejected");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => toast.bad("review failed", (e as Error).message),
  });

  return (
    <li className="rounded-[var(--r-md)] border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="pill pill-simp">{KIND_LABEL[s.kind]}</span>
          <span className="mono text-dim">{short(s.address)}</span>
          {s.handle && <span className="text-sm text-dim">@{s.handle}</span>}
          {s.handle && !s.handleVerified && (
            <span className="pill pill-warn" title="this wallet never proved it owns the handle">
              handle unverified
            </span>
          )}
          <span className="text-xs text-mute">{now !== null ? timeAgo(s.createdAt, now) : ""}</span>
        </div>
        {s.check && (
          <span className={`pill ${!s.check.reachable ? "pill-warn" : s.check.keyword ? "pill-ok" : "pill-bad"}`}>
            {!s.check.reachable ? "x didn't answer" : `by @${s.check.author} · ${s.check.keyword ? "keyword ✓" : "no keyword"}`}
          </span>
        )}
      </div>
      <div className="mt-3 text-sm">
        {s.url ? (
          <a className="link break-all" href={s.url} target="_blank" rel="noreferrer">
            {s.url}
          </a>
        ) : (
          <>
            <p className="text-text">{s.title}</p>
            {s.note && <p className="mt-1 whitespace-pre-wrap text-dim">{s.note}</p>}
            <ul className="mt-2 grid gap-1">
              {(s.proof ?? []).map((p) => (
                <li key={p}>
                  <a className="link break-all" href={p} target="_blank" rel="noreferrer nofollow">
                    {p}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          className="input sm:max-w-[160px]"
          type="number"
          min={bounds.min}
          max={bounds.max}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="reward"
        />
        <input className="input" placeholder="note (optional, shown to the simp)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-primary" disabled={review.isPending} onClick={() => review.mutate("approve")}>
          approve
        </button>
        <button className="btn btn-danger" disabled={review.isPending} onClick={() => review.mutate("reject")}>
          reject
        </button>
      </div>
      <p className="mt-2 text-xs text-mute num">
        range {fmt(bounds.min)}–{fmt(bounds.max)}
      </p>
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
      className="glass grid gap-3 p-7"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="t-h2">grant / revoke</h2>
        <div className="segment">
          {(["grant", "revoke"] as const).map((x) => (
            <button type="button" key={x} data-active={mode === x} onClick={() => setMode(x)}>
              {x}
            </button>
          ))}
        </div>
      </div>
      <input className="input mono" placeholder="0x… wallet" value={address} onChange={(e) => setAddress(e.target.value)} />
      <div className="flex gap-3">
        <input className="input" type="number" min={1} placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <select className="input" value={pool} onChange={(e) => setPool(e.target.value as PoolId)} aria-label="pool">
          {POOLS.map((p) => (
            <option key={p} value={p}>
              {POOL_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      <input className="input" placeholder="note (shows in their history)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className={`btn ${mode === "grant" ? "btn-primary" : "btn-danger"}`} disabled={m.isPending || !address || !amount || note.length < 3}>
        {mode}
      </button>
      <p className="text-xs text-mute">grants come out of the season pool budget; revokes return points to it.</p>
    </form>
  );
}

function SettlePanel() {
  const current = seasonAt();
  const [season, setSeason] = useState(String(Math.max(1, current - 1)));
  const [force, setForce] = useState(false);
  const qc = useQueryClient();
  const snap = useQuery({
    queryKey: ["admin", "settle", season],
    queryFn: () => api<{ settlement: Settlement | null }>(`/api/admin/points/settle?season=${Number(season)}`),
    enabled: Number(season) >= 1,
  });
  const freeze = useMutation({
    mutationFn: () => post<{ settlement: Settlement }>("/api/admin/points/settle", { season: Number(season), force }),
    onSuccess: () => {
      toast.ok("season frozen");
      qc.invalidateQueries({ queryKey: ["admin", "settle"] });
    },
    onError: (e) => toast.bad("freeze failed", (e as Error).message),
  });
  const s = snap.data?.settlement;
  const download = () => {
    if (!s) return;
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `simp-xp-season-${s.season}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="glass grid content-start gap-3 p-7">
      <h2 className="t-h2">settle a season</h2>
      <p className="text-sm text-dim">
        freezes season-earned points into a merkle root for the soulbound xp contract. one-way: a frozen season never changes.
      </p>
      <div className="flex gap-3">
        <input className="input max-w-[120px]" type="number" min={1} value={season} onChange={(e) => setSeason(e.target.value)} aria-label="season" />
        <button className="btn btn-ghost" disabled={!!s || freeze.isPending || Number(season) < 1} onClick={() => freeze.mutate()}>
          freeze
        </button>
      </div>
      {Number(season) >= current && !s && (
        <label className="flex items-center gap-2 text-xs text-warn">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> season still running — freeze anyway
        </label>
      )}
      {s ? (
        <div className="rounded-[var(--r-md)] border border-line p-4 text-sm">
          <p className="text-dim">
            {fmt(s.count)} simps · {fmt(s.total)} xp
          </p>
          <p className="mono mt-2 break-all text-text">{s.root}</p>
          <button className="btn btn-ghost btn-sm mt-3" onClick={download}>
            download rows
          </button>
          <p className="mt-3 text-xs text-mute">
            onchain: <span className="mono">setSeasonRoot({s.season}, root, {s.total})</span>
          </p>
        </div>
      ) : (
        <p className="text-xs text-mute">not frozen yet.</p>
      )}
    </div>
  );
}

function Reviewed({ rows }: { rows: Submission[] }) {
  const now = useNow(30_000);
  if (!rows.length) return null;
  return (
    <div className="glass p-7">
      <h2 className="t-h2">recently reviewed</h2>
      <ul className="mt-4 divide-y divide-[var(--line)]">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
            <span className="min-w-0 truncate text-dim">
              {KIND_LABEL[s.kind]} · <span className="mono">{short(s.address)}</span> · {s.url ?? s.title}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-mute">
                {s.auto ? "auto" : s.reviewedBy ? short(s.reviewedBy) : ""}
                {now !== null && s.reviewedAt ? ` · ${timeAgo(s.reviewedAt, now)}` : ""}
              </span>
              <span className={`pill ${s.status === "approved" ? "pill-ok" : "pill-bad"}`}>
                {s.status === "approved" ? `+${fmt(s.reward ?? 0)}` : "rejected"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
