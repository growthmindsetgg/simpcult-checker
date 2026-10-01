"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useMutation } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useSession } from "@/lib/useSession";
import { useMounted } from "@/lib/useMounted";
import { LINKS, short } from "@/lib/config";
import { WalletButton } from "@/components/wallet/WalletButton";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/Toast";

export function VerifyFlow() {
  const { isConnected, address } = useAccount();
  const { session, isHolder, isLoading } = useSession();
  const [link, setLink] = useState<string | null>(null);

  const issue = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/telegram/link", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "failed");
      return d as { url: string; balance: number };
    },
    onSuccess: (d) => {
      setLink(d.url);
      window.open(d.url, "_blank", "noopener");
      toast.ok("invite issued", "one-time link · valid for 10 minutes");
    },
    onError: (e) => toast.bad("could not issue invite", (e as Error).message.split("\n")[0]),
  });

  const mounted = useMounted();
  const step = !mounted || !isConnected ? 1 : !session ? 2 : !isHolder ? 2.5 : 3;

  // progress line fill: 0 → 1 based on step (1 → 0%, 2 → 33%, 2.5 → 66%, 3 → 100%)
  const progress = step === 1 ? 0 : step === 2 ? 0.33 : step === 2.5 ? 0.66 : 1;

  return (
    <div className="relative mt-14">
      {/* vertical progress track running along the step number gutter */}
      <div className="step-track" aria-hidden>
        <motion.span
          initial={false}
          animate={{ height: `${progress * 100}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      <div className="space-y-4">
        <Step n={1} title="connect your wallet" done={step > 1} active={step === 1}>
          <p className="text-sm text-dim">monad mainnet only. we never ask for approvals.</p>
          {step === 1 && <div className="mt-3"><WalletButton /></div>}
        </Step>

        <Step n={2} title="prove it's yours" done={step > 2.5} active={step === 2 || step === 2.5}>
          <p className="text-sm text-dim">
            sign a free message (or send a 0-MON self-transaction). we read your simp cult balance straight from chain.
          </p>
          {step === 2 && <div className="mt-3"><WalletButton /></div>}
          {step === 2.5 && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="pill pill-warn"><Icon name="warn" className="h-3 w-3" /> {short(address)} holds 0 simp</span>
              <a className="link text-xs" href={LINKS.opensea} target="_blank" rel="noreferrer">get one on opensea →</a>
            </div>
          )}
          {step === 3 && (
            <div className="mt-3"><span className="pill pill-ok"><Icon name="check" className="h-3 w-3" /> holder · {session?.balance} simp</span></div>
          )}
        </Step>

        <Step n={3} title="join telegram" done={false} active={step === 3}>
          <p className="text-sm text-dim">
            you&apos;ll be sent to our bot with a one-time code. it re-checks your balance and hands you a single-use invite
            link valid for 10 minutes.
          </p>
          {step === 3 && (
            <div className="mt-3 space-y-3">
              <button className="btn btn-primary" onClick={() => issue.mutate()} disabled={issue.isPending || isLoading}>
                {issue.isPending ? <Icon name="spinner" /> : <><Icon name="telegram" className="h-4 w-4" /> join telegram</>}
              </button>
              {issue.error && <p className="text-xs text-bad">{(issue.error as Error).message}</p>}
              {link && (
                <p className="text-xs text-dim">
                  didn&apos;t open? <a className="link" href={link} target="_blank" rel="noreferrer">tap here</a> · code expires in 10 min.
                </p>
              )}
            </div>
          )}
        </Step>
      </div>

      <p className="pt-6 text-[13px] text-mute">
        in the group already but linked a different wallet? send <span className="mono">/status</span> or <span className="mono">/unlink</span> to the bot.
      </p>
    </div>
  );
}

function Step({
  n,
  title,
  done,
  active,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`glass relative p-6 transition ${active ? "pulse-neon border-simp/60" : ""} ${
        !active && !done ? "opacity-55" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`relative z-10 grid h-7 w-7 place-items-center rounded-full text-xs font-semibold transition-colors ${
            done ? "bg-ok/25 text-ok" : active ? "bg-simp/25 text-simp-2" : "bg-white/5 text-mute"
          }`}
          aria-hidden
        >
          {done ? <Icon name="check" className="h-3.5 w-3.5" /> : n}
        </span>
        <h3 className="t-h3 text-[17px]">{title}</h3>
      </div>
      <div className="mt-3 pl-10">{children}</div>
    </div>
  );
}
