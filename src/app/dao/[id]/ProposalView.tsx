"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { DAO_ADDRESS, explorerAddress, explorerTx, short } from "@/lib/config";
import { dao, useDaoConfig, useProposal, useMyTokens, useReceipt, useUnusedTokens, deriveState, fmtDate, timeLeft } from "@/lib/dao";
import { useSession } from "@/lib/useSession";
import { useMounted } from "@/lib/useMounted";
import { VoteBars, statePill } from "@/components/dao/ProposalCard";
import { WalletButton } from "@/components/wallet/WalletButton";
import { Icon } from "@/components/Icon";
import { Reveal } from "@/components/motion";
import { toast } from "@/components/Toast";

const CHOICES = [
  { v: 1, label: "for", cls: "border-ok/50 text-ok hover:bg-ok/10" },
  { v: 0, label: "against", cls: "border-bad/50 text-bad hover:bg-bad/10" },
  { v: 2, label: "abstain", cls: "border-line text-dim hover:bg-white/5" },
] as const;

export function ProposalView({ id }: { id: number }) {
  const cfg = useDaoConfig();
  const { data: p, isLoading, error } = useProposal(id);
  const quorum = cfg.data?.quorum ?? 0;
  const mounted = useMounted();
  const [pendingChoice, setPendingChoice] = useState<0 | 1 | 2 | null>(null);
  const [pendingHash, setPendingHash] = useState<string | null>(null);

  if (!mounted || isLoading) return <Wrap><p className="text-sm text-dim">loading proposal…</p></Wrap>;
  if (error || !p) return <Wrap><p className="text-sm text-bad">proposal #{id} not found.</p></Wrap>;

  const s = deriveState(p, quorum);
  return (
    <Wrap>
      <Link href="/dao" className="text-xs text-mute hover:text-white">← all proposals</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-mute">
            #{p.id} · by <a className="link mono" href={explorerAddress(p.proposer)} target="_blank" rel="noreferrer">{short(p.proposer)}</a>
          </div>
          <h1 className="t-h1 mt-2 text-[clamp(28px,4vw,40px)]">{p.title}</h1>
        </div>
        <span className={`pill ${statePill[s]}`}>{s}</span>
      </div>

      <div className="mt-2 text-xs text-mute">
        {fmtDate(p.start)} → {fmtDate(p.end)} {s === "active" && <b className="text-simp-2">· {timeLeft(p.end)}</b>}
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-[1fr_340px]">
        <div className="glass whitespace-pre-wrap p-7 text-[15px] leading-[1.75] text-text/90">
          {p.description || <span className="text-mute">no description.</span>}
        </div>
        <div className="space-y-4">
          <div className="glass p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="t-h3 text-[15px]">results</h3>
              {pendingHash && (
                <span className="pill pill-warn">
                  <Icon name="spinner" className="h-3 w-3" />
                  pending
                </span>
              )}
            </div>
            <VoteBars p={p} quorum={quorum} pendingChoice={pendingChoice} />
          </div>
          <VotePanel
            id={id}
            state={s}
            proposer={p.proposer}
            pendingChoice={pendingChoice}
            pendingHash={pendingHash}
            setPendingChoice={setPendingChoice}
            setPendingHash={setPendingHash}
          />
        </div>
      </div>
    </Wrap>
  );
}

function VotePanel({
  id,
  state,
  proposer,
  pendingChoice,
  pendingHash,
  setPendingChoice,
  setPendingHash,
}: {
  id: number;
  state: string;
  proposer: string;
  pendingChoice: 0 | 1 | 2 | null;
  pendingHash: string | null;
  setPendingChoice: (v: 0 | 1 | 2 | null) => void;
  setPendingHash: (h: string | null) => void;
}) {
  const { address, isConnected } = useAccount();
  const { session, isHolder } = useSession();
  const tokens = useMyTokens();
  const receipt = useReceipt(id);
  const unused = useUnusedTokens(id, tokens.data);
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | "cancel" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const myChoice = receipt.data ? receipt.data - 1 : null; // 0 against, 1 for, 2 abstain
  const free = unused.data ?? [];
  const canVote = state === "active" && isHolder && free.length > 0;

  async function vote(v: 0 | 1 | 2) {
    setErr(null);
    setBusy(v);
    setPendingChoice(v);
    const label = ["against", "for", "abstain"][v];
    try {
      const hash = await writeContractAsync({
        ...dao,
        functionName: "castVote",
        args: [BigInt(id), v, free.map(BigInt)],
      });
      setPendingHash(hash);
      toast.info("vote sent", `casting ${label} · waiting for confirmation`);
      await client!.waitForTransactionReceipt({ hash });
      qc.invalidateQueries();
      toast.ok("vote mined", `you voted ${label} on #${id}`);
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      setErr(msg);
      toast.bad("vote failed", msg);
      setPendingChoice(null);
    } finally {
      setBusy(null);
      setPendingHash(null);
    }
  }

  async function cancel() {
    setErr(null);
    setBusy("cancel");
    try {
      const hash = await writeContractAsync({ ...dao, functionName: "cancel", args: [BigInt(id)] });
      toast.info("cancel sent", "waiting for confirmation");
      await client!.waitForTransactionReceipt({ hash });
      qc.invalidateQueries();
      toast.ok("proposal canceled", `#${id} is now closed`);
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      setErr(msg);
      toast.bad("cancel failed", msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="glass p-6">
      <h3 className="t-h3 mb-4 text-[15px]">your vote</h3>

      {!isConnected || !session ? (
        <>
          <p className="mb-3 text-xs text-dim">connect and verify to vote.</p>
          <WalletButton className="w-full" />
        </>
      ) : !isHolder ? (
        <p className="text-xs text-dim">this wallet holds no simp cult nft.</p>
      ) : state !== "active" ? (
        <p className="text-xs text-dim">
          voting is {state === "pending" ? "not open yet" : "closed"}.
          {myChoice !== null && (
            <> you voted <b className="text-text">{["against", "for", "abstain"][myChoice]}</b>.</>
          )}
        </p>
      ) : (
        <>
          <div className="mb-3 text-xs text-dim">
            you hold <b className="text-text">{tokens.data?.length ?? "…"}</b> nft
            {(tokens.data?.length ?? 0) === 1 ? "" : "s"}
            {tokens.data && free.length !== tokens.data.length && (
              <> · {tokens.data.length - free.length} already voted</>
            )}
            {myChoice !== null && (
              <> · locked to <b className="text-text">{["against", "for", "abstain"][myChoice]}</b></>
            )}
          </div>
          <div className="grid gap-2.5">
            {CHOICES.map((c) => {
              const disabled = !canVote || busy !== null || (myChoice !== null && myChoice !== c.v);
              const isBusy = busy === c.v;
              return (
                <button
                  key={c.v}
                  disabled={disabled}
                  onClick={() => vote(c.v as 0 | 1 | 2)}
                  className={`btn w-full border ${c.cls} ${myChoice === c.v || pendingChoice === c.v ? "bg-white/5" : ""}`}
                  aria-label={`vote ${c.label}`}
                >
                  {isBusy ? <Icon name="spinner" /> : <>{c.label} {free.length > 0 && `· ${free.length}`}</>}
                </button>
              );
            })}
          </div>
          {free.length === 0 && tokens.data && tokens.data.length > 0 && (
            <p className="mt-3 text-xs text-ok">all your nfts have voted on this proposal.</p>
          )}
          <p className="mt-3 text-[11px] text-mute">
            one transaction to <span className="mono">{short(DAO_ADDRESS)}</span> · castVote({id}, choice, your tokenIds). no approvals.
          </p>
        </>
      )}

      {pendingHash && (
        <a className="link mt-3 block text-xs" href={explorerTx(pendingHash)} target="_blank" rel="noreferrer">
          view transaction ↗
        </a>
      )}
      {err && <p className="mt-3 text-xs text-bad">{err}</p>}

      {address && address.toLowerCase() === proposer.toLowerCase() && (state === "active" || state === "pending") && (
        <button className="btn btn-danger mt-4 w-full" onClick={cancel} disabled={busy !== null}>
          {busy === "cancel" ? <Icon name="spinner" /> : "cancel proposal"}
        </button>
      )}
    </div>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-5xl px-5 pb-32 pt-36">
      <Reveal>{children}</Reveal>
    </section>
  );
}
