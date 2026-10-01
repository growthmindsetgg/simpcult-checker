"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { isAddress } from "viem";
import { Icon } from "@/components/Icon";
import { useMounted } from "@/lib/useMounted";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "@/components/Toast";
import { LINKS, short } from "@/lib/config";

type Result = { eligible: boolean; gtd: boolean; fcfs: boolean; gtdMints: number; fcfsMints: number };

export function CheckerForm() {
  const { address: connected } = useAccount();
  const [addr, setAddr] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const mounted = useMounted();

  async function check(a: string) {
    setErr(null);
    setRes(null);
    setChecked(null);
    if (!isAddress(a)) return setErr("enter a valid wallet address");
    setBusy(true);
    try {
      const r = await fetch("/api/checker", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: a }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "failed");
      setRes(d);
      setChecked(a);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyAddr() {
    if (!checked) return;
    try {
      await navigator.clipboard.writeText(checked);
      setCopied(true);
      toast.ok("copied", `${short(checked)} on the clipboard`, 2200);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.bad("clipboard blocked", "browser wouldn't let us copy — highlight the address instead");
    }
  }

  const shareUrl = (() => {
    if (!res?.eligible || !checked) return null;
    const parts: string[] = [];
    if (res.gtd) parts.push(`${res.gtdMints} × gtd`);
    if (res.fcfs) parts.push(`${res.fcfsMints} × fcfs`);
    const text = `i'm on the simp cult mint list — ${parts.join(" + ")}. simping until we actually get it.\n\n${LINKS.opensea}`;
    return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://simpcult.xyz/checker")}`;
  })();

  return (
    <form
      className="mt-8"
      onSubmit={(e) => {
        e.preventDefault();
        check(addr.trim());
      }}
    >
      <label htmlFor="wl-addr" className="sr-only">
        wallet address
      </label>
      <input
        id="wl-addr"
        className="input mono"
        placeholder="0x…"
        value={addr}
        onChange={(e) => setAddr(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={!!err}
        aria-describedby={err ? "wl-err" : undefined}
      />
      <div className="mt-3 flex gap-2.5">
        <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
          {busy ? <Icon name="spinner" /> : "search"}
        </button>
        {mounted && connected && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setAddr(connected);
              check(connected);
            }}
          >
            use connected
          </button>
        )}
      </div>

      {err && (
        <p id="wl-err" className="mt-4 text-sm text-bad">
          {err}
        </p>
      )}

      <AnimatePresence mode="wait">
        {res && checked && (
          <motion.div
            key={checked + String(res.eligible)}
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 22, mass: 0.7 }}
            className={`mt-6 rounded-2xl border p-5 ${
              res.eligible ? "border-ok/30 bg-ok/8" : "border-bad/30 bg-bad/8"
            }`}
          >
            <div className={`flex items-center gap-2 font-semibold ${res.eligible ? "text-ok" : "text-bad"}`}>
              <Icon name={res.eligible ? "check" : "close"} className="h-4 w-4" />
              {res.eligible ? "eligible" : "not eligible"}
            </div>

            {res.eligible && (
              <div className="mt-3 flex flex-wrap gap-2">
                {res.gtd && <span className="pill pill-ok">{res.gtdMints} × gtd mint</span>}
                {res.fcfs && <span className="pill pill-simp">{res.fcfsMints} × fcfs mint</span>}
              </div>
            )}

            {!res.eligible && (
              <p className="mt-1 text-xs text-dim">not on the list this time. keep simping.</p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="mono text-[11.5px] text-mute">{short(checked)}</span>
              <button
                type="button"
                onClick={copyAddr}
                className="btn btn-ghost btn-sm"
                aria-label="copy address"
              >
                <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
                {copied ? "copied" : "copy"}
              </button>
              {shareUrl && (
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost btn-sm"
                  aria-label="share on x"
                >
                  <Icon name="x" className="h-3 w-3" />
                  share
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}
