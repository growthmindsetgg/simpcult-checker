"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage, useSendTransaction, usePublicClient } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { stringToHex } from "viem";
import { CHAIN_ID, SITE } from "@/lib/config";

export type SessionInfo = {
  address: `0x${string}`;
  method: "siwe" | "tx";
  balance: number;
  exp: number;
};

async function j<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(input, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `request failed (${r.status})`);
  return data as T;
}

export function useSession() {
  const q = useQuery({
    queryKey: ["session"],
    queryFn: () => j<{ session: SessionInfo | null }>("/api/auth/session").then((d) => d.session),
    staleTime: 30_000,
  });
  const { address } = useAccount();
  // session only counts if it matches the currently connected wallet
  const session = q.data && address && q.data.address.toLowerCase() === address.toLowerCase() ? q.data : null;
  return { ...q, session, isHolder: (session?.balance ?? 0) > 0 };
}

/** SIWE: sign a human-readable message. No gas, no approvals. */
export function useVerifyBySignature() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  return useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("connect a wallet first");
      const { nonce } = await j<{ nonce: string }>("/api/auth/nonce");
      const message = createSiweMessage({
        address,
        chainId: CHAIN_ID,
        domain: SITE.domain,
        nonce,
        uri: typeof window !== "undefined" ? window.location.origin : SITE.url,
        version: "1",
        statement:
          "sign in to simp cult. this is a signature, not a transaction — it costs nothing and cannot move your assets.",
        expirationTime: new Date(Date.now() + 5 * 60 * 1000),
      });
      const signature = await signMessageAsync({ message });
      return j<SessionInfo>("/api/auth/verify", { method: "POST", body: JSON.stringify({ message, signature }) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}

/** Self-transaction: 0 MON from you → to you, nonce in calldata. */
export function useVerifyByTransaction() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const client = usePublicClient();

  return useMutation({
    mutationFn: async () => {
      if (!address || !client) throw new Error("connect a wallet first");
      const { nonce } = await j<{ nonce: string }>("/api/auth/nonce");
      const hash = await sendTransactionAsync({
        to: address,
        value: 0n,
        data: stringToHex(`simpcult:${nonce}`),
        chainId: CHAIN_ID,
      });
      await client.waitForTransactionReceipt({ hash, confirmations: 1 });
      return j<SessionInfo>("/api/auth/verify-tx", { method: "POST", body: JSON.stringify({ hash, nonce }) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => j("/api/auth/logout", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}
