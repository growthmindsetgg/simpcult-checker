"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider, cookieToInitialState } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { wagmiConfig } from "@/lib/wagmi";

export function Providers({
  children,
  cookie,
}: {
  children: ReactNode;
  cookie?: string | null;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
      }),
  );
  const initialState = cookieToInitialState(wagmiConfig, cookie);

  // reducedMotion="user" drops x/y/scale/rotate from animations when the OS
  // preference is set — no per-component `useReducedMotion()` gates needed,
  // which was causing hydration mismatches (server rendered hidden initial,
  // client under reduced-motion skipped it).
  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
