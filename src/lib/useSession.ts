"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage, useSendTransaction, usePublicClient } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import type { Hex } from "viem";
import { CHAIN_ID, SITE } from "@/lib/config";

export type SessionInfo = {
  address: `0x${string}`;
  method: "siwe" | "tx";
  balance: number;
  exp: number;
};

/** what POST /api/auth/nonce returns for the self-transaction ("send and set") path */
export type SelfTxChallenge = {
  nonce: string;
  expiresAt: number;
  tx: { chainId: number; from: `0x${string}`; to: `0x${string}`; value: "0"; data: Hex };
};

/**
 * sessionStorage key for a pending "send and set" code. Any new nonce request
 * replaces the browser's nonce cookie and orphans that code, so every other
 * sign-in path clears it first (a stale slip would cost someone gas for nothing).
 */
export const SELFTX_STORAGE_KEY = "simp:selftx:v1";
function dropPendingSelfTx() {
  try {
    window.sessionStorage.removeItem(SELFTX_STORAGE_KEY);
  } catch {}
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(input: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(input, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError("can’t reach the site. check your connection and try again.", 0);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError((data as { error?: string }).error ?? `request failed (${r.status})`, r.status);
  return data as T;
}

/** one short, human line for any wallet / network / API error */
export function humanError(e: unknown): string {
  const err = e as { name?: string; code?: number; shortMessage?: string; message?: string; cause?: unknown } | null;
  const chain = [err, err?.cause as typeof err].filter(Boolean) as NonNullable<typeof err>[];
  for (const x of chain) {
    if (x.code === 4001 || x.name === "UserRejectedRequestError" || /user (rejected|denied)|rejected the request/i.test(x.message ?? "")) {
      return "you cancelled it in your wallet.";
    }
    if (x.name === "ProviderNotFoundError" || /provider not found/i.test(x.message ?? "")) {
      return "no browser wallet found. install one, or verify by sending a transaction instead.";
    }
  }
  const msg = err?.shortMessage ?? err?.message ?? "something went wrong. try again.";
  return msg.split("\n")[0];
}

export function useSession() {
  const q = useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ session: SessionInfo | null }>("/api/auth/session").then((d) => d.session),
    staleTime: 30_000,
  });
  const { address } = useAccount();
  // the server session counts unless a DIFFERENT wallet is connected: someone
  // who verified by self-transaction ("send and set") never connects a wallet
  // here, and a wallet switch must not keep showing the old address as signed in
  const session =
    q.data && (!address || q.data.address.toLowerCase() === address.toLowerCase()) ? q.data : null;
  return { ...q, session, serverSession: q.data ?? null, isHolder: (session?.balance ?? 0) > 0 };
}

/** SIWE: sign a human-readable message. No gas, no approvals. */
export function useVerifyBySignature() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  return useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("connect a wallet first");
      dropPendingSelfTx();
      const { nonce } = await api<{ nonce: string }>("/api/auth/nonce");
      const message = createSiweMessage({
        address,
        chainId: CHAIN_ID,
        domain: SITE.domain,
        nonce,
        uri: typeof window !== "undefined" ? window.location.origin : SITE.url,
        version: "1",
        statement:
          "sign in to simp cult. this is a signature, not a transaction — it costs nothing and cannot move your assets.",
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 5 * 60 * 1000),
      });
      const signature = await signMessageAsync({ message });
      return api<SessionInfo>("/api/auth/verify", { method: "POST", body: JSON.stringify({ message, signature }) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}

/** Self-transaction from the connected wallet: 0 MON from you → to you, nonce in calldata. */
export function useVerifyByTransaction() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const client = usePublicClient();

  return useMutation({
    mutationFn: async () => {
      if (!address || !client) throw new Error("connect a wallet first");
      dropPendingSelfTx();
      const c = await api<SelfTxChallenge>("/api/auth/nonce", { method: "POST", body: JSON.stringify({ address }) });
      const hash = await sendTransactionAsync({
        to: c.tx.to,
        value: 0n,
        data: c.tx.data,
        chainId: CHAIN_ID,
      });
      await client.waitForTransactionReceipt({ hash, confirmations: 1 });
      return api<SessionInfo>("/api/auth/verify-tx", {
        method: "POST",
        body: JSON.stringify({ hash, nonce: c.nonce, address }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}
