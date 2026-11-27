"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { DAO_ADDRESS, DAO_DEPLOYED, explorerAddress, short } from "@/lib/config";
import { useDaoConfig, useProposals, deriveState } from "@/lib/dao";
import { useSession } from "@/lib/useSession";
import { useMounted } from "@/lib/useMounted";
import { ProposalCard } from "@/components/dao/ProposalCard";
import { WalletButton } from "@/components/wallet/WalletButton";
import { Reveal, Stagger, Item, Spotlight } from "@/components/motion";
import { PageHeader } from "@/components/PageHeader";
import { NewProposal } from "./NewProposal";
import type { ArchivedProposal } from "./page";

export function DaoHome({ archive }: { archive: ArchivedProposal[] }) {
  const cfg = useDaoConfig();
  const props = useProposals(cfg.data?.count);
  const { session, isHolder } = useSession();
  // a server session alone (the walletless "send a transaction" sign-in) cannot propose: that needs a connected wallet
  const { isConnected } = useAccount();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"live" | "past" | "archive">("live");
  const mounted = useMounted();

  const quorum = cfg.data?.quorum ?? 0;
  const all = props.data ?? [];
  const live = all.filter((p) => ["active", "pending"].includes(deriveState(p, quorum)));
  const past = all.filter((p) => !["active", "pending"].includes(deriveState(p, quorum)));
  const shownArchive = archive.filter((a) => a.id !== "archive-example");

  return (
    <section className="page max-w-5xl">
      <PageHeader
        title="Simp DAO"
        lead="One NFT, one vote. Holders open proposals, holders decide. Every vote is a Monad transaction, so nobody edits history."
        aside={
          mounted && session && isHolder && isConnected ? (
            <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={!DAO_DEPLOYED}>
              New proposal
            </button>
          ) : (
            <WalletButton />
          )
        }
      />
      <Reveal>

      {/* not live yet. to go live: deploy contracts/SimpDAO.sol and set NEXT_PUBLIC_DAO_ADDRESS;
          proposals then show up here on their own. */}
      {!DAO_DEPLOYED && (
        <div className="on-light mt-10 flex flex-wrap items-baseline gap-x-5 gap-y-1.5 rounded-[var(--key-radius-xl)] bg-[var(--lav)] px-6 py-5 shadow-[0_24px_50px_-28px_rgba(14,9,28,0.8)]">
          <span className="t-caps text-[var(--lav-ink-2)]">Not open yet</span>
          <p className="font-serif text-[19px] italic leading-snug text-[var(--lav-ink)]">
            Voting opens when the DAO contract is live on Monad.
          </p>
        </div>
      )}

      {DAO_DEPLOYED && cfg.data && cfg.data.period > 0 && (
        <div className="mono mt-8 flex flex-wrap gap-x-7 gap-y-2 text-[12.5px] text-mute">
          <span>Quorum <b className="text-dim">{cfg.data.quorum} votes</b></span>
          <span>Voting period <b className="text-dim">{Math.round(cfg.data.period / 3600)}h</b></span>
          <span>To propose <b className="text-dim">≥ {cfg.data.threshold} nft</b></span>
          <span>Contract <a className="link mono" href={explorerAddress(DAO_ADDRESS)} target="_blank" rel="noreferrer">{short(DAO_ADDRESS)}</a></span>
        </div>
      )}

      </Reveal>

      <div className="segment mt-12">
        {(["live", "past", "archive"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} data-active={tab === t}>
            {t[0].toUpperCase() + t.slice(1)}
            <span className="num">{t === "live" ? live.length : t === "past" ? past.length : shownArchive.length}</span>
          </button>
        ))}
      </div>

      <Stagger key={tab} className="mt-7 grid gap-5 md:grid-cols-2">
        {tab === "live" && (live.length ? live.map((p) => <ProposalCard key={p.id} p={p} quorum={quorum} />) : <Empty text={!mounted || props.isLoading ? "Loading proposals…" : "No live proposals. Holders can open one."} />)}
        {tab === "past" && (past.length ? past.map((p) => <ProposalCard key={p.id} p={p} quorum={quorum} />) : <Empty text="Nothing has closed yet." />)}
        {tab === "archive" && (shownArchive.length ? shownArchive.map((a) => <ArchiveCard key={a.id} a={a} />) : <Empty text="Votes held before the on-chain DAO will be listed here." />)}
      </Stagger>

      <NewProposal open={creating} onClose={() => setCreating(false)} />
      <p className="mt-12 text-[13px] text-mute">
        Not verified yet? Sign in from the wallet menu or on the{" "}
        <Link href="/join" className="link">
          join page
        </Link>
        .
      </p>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <Item className="col-span-full"><div className="rounded-[var(--r-lg)] border border-dashed border-line-strong px-6 py-12 text-center font-serif text-[19px] italic text-dim">{text}</div></Item>;
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
              <div className="bar"><span style={{ width: `${pct}%`, background: "var(--gold)" }} /></div>
            </div>
          );
        })}
      </div>
      {a.link && <a className="link mt-4 inline-block text-xs" href={a.link} target="_blank" rel="noreferrer">source</a>}
    </div></Spotlight></Item>
  );
}
