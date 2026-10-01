"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { short } from "@/lib/config";
import { type Proposal, type StateName, deriveState, fmtDate, timeLeft } from "@/lib/dao";
import { Item, Spotlight } from "@/components/motion";

export const statePill: Record<StateName, string> = {
  pending: "pill-warn",
  active: "pill-simp",
  canceled: "pill",
  defeated: "pill-bad",
  succeeded: "pill-ok",
};

export function VoteBars({
  p,
  quorum,
  pendingChoice,
}: {
  p: Proposal;
  quorum: number;
  /** optimistic overlay: bump the picked bar by +1 while the tx is unmined */
  pendingChoice?: 0 | 1 | 2 | null;
}) {
  // apply optimistic overlay (0 = against, 1 = for, 2 = abstain)
  const forVotes = p.forVotes + (pendingChoice === 1 ? 1 : 0);
  const againstVotes = p.againstVotes + (pendingChoice === 0 ? 1 : 0);
  const abstainVotes = p.abstainVotes + (pendingChoice === 2 ? 1 : 0);
  const total = forVotes + againstVotes + abstainVotes;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <div className="space-y-3 text-xs">
      <Row label="for" n={forVotes} pct={pct(forVotes)} color="var(--ok)" flash={pendingChoice === 1} />
      <Row label="against" n={againstVotes} pct={pct(againstVotes)} color="var(--bad)" flash={pendingChoice === 0} />
      <Row label="abstain" n={abstainVotes} pct={pct(abstainVotes)} color="var(--text-mute)" flash={pendingChoice === 2} />
      <div className="flex justify-between text-mute">
        <span>
          {total} vote{total === 1 ? "" : "s"}
        </span>
        <span>
          quorum {Math.min(total, quorum)}/{quorum}
        </span>
      </div>
    </div>
  );
}

/** bar rendered at 0% first, then animates to target pct via CSS transition */
function Row({ label, n, pct, color, flash }: { label: string; n: number; pct: number; color: string; flash?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "0px 0px -5% 0px", threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const width = visible ? `${pct}%` : "0%";
  return (
    <div ref={ref}>
      <div className="mb-1 flex justify-between">
        <span className="text-dim">
          {label}
          {flash && <span className="ml-2 text-simp-2">· voting…</span>}
        </span>
        <span className="text-text">
          {n} · {pct}%
        </span>
      </div>
      <div className="bar">
        <span style={{ width, background: color }} />
      </div>
    </div>
  );
}

export function ProposalCard({ p, quorum }: { p: Proposal; quorum: number }) {
  const s = deriveState(p, quorum);
  return (
    <Item className="h-full">
      <Spotlight className="h-full">
        <Link href={`/dao/${p.id}`} className="glass glass-hover flex h-full flex-col p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="mono text-mute">
                #{p.id} · by {short(p.proposer)}
              </div>
              <h3 className="t-h3 mt-2 text-[17px]">{p.title}</h3>
            </div>
            <span className={`pill ${statePill[s]}`}>{s}</span>
          </div>
          <p className="mt-3 line-clamp-2 text-[14px] leading-relaxed text-dim">{p.description}</p>
          <div className="mt-6 flex-1">
            <VoteBars p={p} quorum={quorum} />
          </div>
          <div className="mt-4 text-xs text-mute">
            {s === "active" ? timeLeft(p.end) : s === "pending" ? `opens ${fmtDate(p.start)}` : `ended ${fmtDate(p.end)}`}
          </div>
        </Link>
      </Spotlight>
    </Item>
  );
}
