"use client";

import { useState } from "react";
import { useMounted } from "@/lib/useMounted";
import { useAccount } from "wagmi";
import { short } from "@/lib/config";
import { useSession } from "@/lib/useSession";
import { WalletModal } from "./WalletModal";
import { Icon } from "../Icon";

export function WalletButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const mounted = useMounted();
  const { address, isConnected } = useAccount();
  const { session, isHolder } = useSession();

  const label = !mounted || !isConnected ? "connect" : session ? short(address) : `${short(address)} · verify`;
  const dot = session ? (isHolder ? "bg-ok" : "bg-warn") : isConnected ? "bg-simp" : "bg-mute";

  return (
    <>
      <button className={`btn ${isConnected ? "btn-ghost" : "btn-primary"} ${className}`} onClick={() => setOpen(true)}>
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {mounted && isConnected ? <span className="mono">{label}</span> : (<><Icon name="wallet" className="h-4 w-4" /> {label}</>)}
      </button>
      <WalletModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
