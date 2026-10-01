"use client";

import { useState } from "react";
import Link from "next/link";
import { DAO_ADDRESS, DAO_DEPLOYED, explorerAddress, short } from "@/lib/config";
import { useDaoConfig, useProposals, deriveState } from "@/lib/dao";
import { useSession } from "@/lib/useSession";
import { useMounted } from "@/lib/useMounted";
import { ProposalCard } from "@/components/dao/ProposalCard";
import { WalletButton } from "@/components/wallet/WalletButton";
import { Icon } from "@/components/Icon";
import { Reveal, Stagger, Item, Spotlight } from "@/components/motion";
import { NewProposal } from "./NewProposal";
import type { ArchivedProposal } from "./page";

export function DaoHome({ archive }: { archive: ArchivedProposal[] }) {
  const cfg = useDaoConfig();
  const props = useProposals(cfg.data?.count);
  const { session, isHolder } = useSession();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"live" | "past" | "archive">("live");
  const mounted = useMounted();

  const quorum = cfg.data?.quorum ?? 0;
  const all = props.data ?? [];
  const live = all.filter((p) => ["active", "pending"].includes(deriveState(p, quorum)));
  const past = all.filter((p) => !["active", "pending"].includes(deriveState(p, quorum)));
  const shownArchive = archive.filter((a) => a.id !== "archive-example");

  return (
    <section className="mx-auto w-full max-w-5xl px-5 pb-32 pt-36">
      <Reveal>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="t-eyebrow mb-4">on-chain · monad</p>
          <h1 className="t-h1 text-[clamp(34px,5vw,52px)]">simp dao</h1>
          <p className="t-lead mt-5">
            one nft, one vote. holders open proposals, holders decide. every vote is a transaction on monad — nothing
            here can be edited after the fact.
          </p>
        </div>
        <div className="flex items-center gap-2 pb-1">
          {mounted && session && isHolder ? (
            <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={!DAO_DEPLOYED}>
              + new proposal
            </button>
          ) : (
            <WalletButton />
          )}
        </div>
      </div>

      {!DAO_DEPLOYED && (
        <div className="glass mt-10 flex items-start gap-3 p-6 text-sm text-dim">
          <Icon name="warn" className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <span>
            the dao contract isn&apos;t deployed yet. deploy <span className="mono">contracts/SimpDAO.sol</span> and set{" "}
            <span className="mono">NEXT_PUBLIC_DAO_ADDRESS</span>. live proposals will show up here automatically.
          </span>
        </div>
      )}

      {DAO_DEPLOYED && cfg.data && cfg.data.period > 0 && (
        <div className="mt-8 flex flex-wrap gap-x-7 gap-y-2 text-[13px] text-mute">
          <span>quorum <b className="text-dim">{cfg.data.quorum} votes</b></span>
          <span>voting period <b className="text-dim">{Math.round(cfg.data.period / 3600)}h</b></span>
          <span>to propose <b className="text-dim">≥ {cfg.data.threshold} nft</b></span>
          <span>contract <a className="link mono" href={explorerAddress(DAO_ADDRESS)} target="_blank" rel="noreferrer">{short(DAO_ADDRESS)}</a></span>
        </div>
      )}

      </Reveal>

      <div className="segment mt-12">
        {(["live", "past", "archive"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} data-active={tab === t}>
            {t} {t === "live" ? `· ${live.length}` : t === "past" ? `· ${past.length}` : `· ${shownArchive.length}`}
          </button>
        ))}
      </div>

      <Stagger key={tab} className="mt-7 grid gap-5 md:grid-cols-2">
        {tab === "live" && (live.length ? live.map((p) => <ProposalCard key={p.id} p={p} quorum={quorum} />) : <Empty text={!mounted || props.isLoading ? "loading…" : "no live proposals. holders can open one."} />)}
        {tab === "past" && (past.length ? past.map((p) => <ProposalCard key={p.id} p={p} quorum={quorum} />) : <Empty text="nothing has closed yet." />)}
        {tab === "archive" && (shownArchive.length ? shownArchive.map((a) => <ArchiveCard key={a.id} a={a} />) : <Empty text="votes held before the on-chain dao will be listed here." />)}
      </Stagger>

      <NewProposal open={creating} onClose={() => setCreating(false)} />
      <p className="mt-12 text-[13px] text-mute">
        need to verify first? open the wallet menu and sign in. <Link href="/security" className="link">how voting stays safe →</Link>
      </p>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <Item className="col-span-full"><div className="glass p-10 text-center text-sm text-dim">{text}</div></Item>;
}

function ArchiveCard({ a }: { a: ArchivedProposal }) {
  const total = a.options.reduce((s, o) => s + o.votes, 0);
  return (
    <Item><Spotlight className="h-full"><div className="glass glass-hover h-full p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mono text-mute">{a.date} · {a.source}</div>
          <h3 className="t-h3 mt-2 text-[17px]">{a.title}</h3>
        </div>
        <span className="pill">{a.result}</span>
      </div>
      <p className="mt-3 text-[14px] leading-relaxed text-dim">{a.description}</p>
      <div className="mt-6 space-y-3 text-xs">
        {a.options.map((o) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0;
          return (
            <div key={o.label}>
              <div className="mb-1 flex justify-between"><span className="text-dim">{o.label}</span><span>{o.votes} · {pct}%</span></div>
              <div className="bar"><span style={{ width: `${pct}%`, background: "var(--simp)" }} /></div>
            </div>
          );
        })}
      </div>
      {a.link && <a className="link mt-4 inline-block text-xs" href={a.link} target="_blank" rel="noreferrer">source ↗</a>}
    </div></Spotlight></Item>
  );
}
