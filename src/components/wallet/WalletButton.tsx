"use client";

import { useState } from "react";
import { useMounted } from "@/lib/useMounted";
import { useAccount } from "wagmi";
import { short } from "@/lib/config";
import { useSession } from "@/lib/useSession";
import { WalletModal } from "./WalletModal";

/**
 * `variant="quiet"` keeps the button brass even before connecting, so it never
 * competes with the page's one neon call to action (the nav uses it).
 * Someone verified by self-transaction has a session but no connected wallet:
 * they see their address too.
 */
export function WalletButton({ className = "", variant = "primary" }: { className?: string; variant?: "primary" | "quiet" }) {
  const [open, setOpen] = useState(false);
  const mounted = useMounted();
  const { address, isConnected } = useAccount();
  const { session, isHolder } = useSession();

  const shown = mounted && (isConnected || !!session);
  const label = !shown ? "connect" : session ? short(session.address) : `${short(address)} · verify`;
  const dot = session ? (isHolder ? "bg-ok" : "bg-warn") : "bg-gold";

  return (
    <>
      <button
        type="button"
        className={`btn ${shown || variant === "quiet" ? "btn-ghost" : "btn-primary"} ${className}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        {shown && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />}
        {shown ? <span className="mono">{label}</span> : label}
      </button>
      <WalletModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
