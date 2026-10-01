"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWriteContract, usePublicClient } from "wagmi";
import { decodeEventLog } from "viem";
import { dao, useDaoConfig } from "@/lib/dao";
import { DAO_ADDRESS, short } from "@/lib/config";
import { Icon } from "@/components/Icon";
import { ModalShell } from "@/components/motion";
import { toast } from "@/components/Toast";

export function NewProposal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "wallet" | "mining">("idle");
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  const cfg = useDaoConfig();
  const router = useRouter();

  async function submit() {
    setErr(null);
    if (!title.trim() || title.length > 120) return setErr("title: 1–120 characters");
    if (desc.length > 4000) return setErr("description: max 4000 characters");
    try {
      setStage("wallet");
      const hash = await writeContractAsync({ ...dao, functionName: "propose", args: [title.trim(), desc.trim()] });
      setStage("mining");
      toast.info("proposal sent", "waiting for confirmation on monad");
      const rc = await client!.waitForTransactionReceipt({ hash });
      let id: number | null = null;
      for (const log of rc.logs) {
        try {
          const ev = decodeEventLog({ abi: dao.abi, data: log.data, topics: log.topics });
          if (ev.eventName === "ProposalCreated") id = Number(ev.args.id);
        } catch { /* not ours */ }
      }
      toast.ok("proposal live", id !== null ? `#${id} is now open for voting` : "opening now");
      onClose();
      router.push(id !== null ? `/dao/${id}` : "/dao");
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      setErr(msg);
      toast.bad("proposal failed", msg);
      setStage("idle");
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} className="max-w-lg">
        <h2 className="t-h2 text-[24px]">new proposal</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-dim">
          this sends one transaction to <span className="mono">{short(DAO_ADDRESS)}</span> (propose). voting opens{" "}
          {cfg.data?.delay ? `after ${Math.round(cfg.data.delay / 60)} min` : "immediately"} and runs{" "}
          {cfg.data ? `${Math.round(cfg.data.period / 3600)}h` : "…"}.
        </p>
        <div className="mt-6 space-y-3">
          <input className="input" placeholder="title (max 120)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          <textarea className="input min-h-36 resize-y" placeholder="what are we deciding? be specific: what, why, cost, who executes." value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={4000} />
          <div className="text-right text-[11px] text-mute">{desc.length}/4000</div>
        </div>
        {err && <p className="mt-2 text-xs text-bad">{err}</p>}
        <div className="mt-5 flex gap-2.5">
          <button className="btn btn-primary flex-1" onClick={submit} disabled={stage !== "idle"}>
            {stage === "idle" ? "submit on-chain" : stage === "wallet" ? <><Icon name="spinner" /> confirm in wallet</> : <><Icon name="spinner" /> mining…</>}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={stage === "mining"}>cancel</button>
        </div>
    </ModalShell>
  );
}
