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
 */
export function WalletButton({ className = "", variant = "primary" }: { className?: string; variant?: "primary" | "quiet" }) {
  const [open, setOpen] = useState(false);
  const mounted = useMounted();
  const { address, isConnected } = useAccount();
  const { session, isHolder } = useSession();

  const label = !mounted || !isConnected ? "connect" : session ? short(address) : `${short(address)} · verify`;
  const dot = session ? (isHolder ? "bg-ok" : "bg-warn") : isConnected ? "bg-gold" : "bg-mute";

  return (
    <>
      <button className={`btn ${isConnected || variant === "quiet" ? "btn-ghost" : "btn-primary"} ${className}`} onClick={() => setOpen(true)}>
        {mounted && isConnected && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />}
        {mounted && isConnected ? <span className="mono">{label}</span> : label}
      </button>
      <WalletModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
