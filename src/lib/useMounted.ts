"use client";
import { useSyncExternalStore } from "react";

/** false during SSR + hydration, true after — avoids markup mismatches for wallet/query-dependent UI */
export function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
