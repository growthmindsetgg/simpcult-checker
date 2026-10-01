"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { simpDaoAbi } from "@/lib/abi/simpDao";
import { DAO_ADDRESS, DAO_DEPLOYED } from "@/lib/config";

export const dao = { address: DAO_ADDRESS, abi: simpDaoAbi } as const;

export type Proposal = {
  id: number;
  proposer: `0x${string}`;
  start: number;
  end: number;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  canceled: boolean;
  title: string;
  description: string;
};

export const STATE = ["pending", "active", "canceled", "defeated", "succeeded"] as const;
export type StateName = (typeof STATE)[number];

export function deriveState(p: Proposal, quorum: number, now = Date.now() / 1000): StateName {
  if (p.canceled) return "canceled";
  if (now < p.start) return "pending";
  if (now < p.end) return "active";
  const total = p.forVotes + p.againstVotes + p.abstainVotes;
  if (total < quorum) return "defeated";
  return p.forVotes > p.againstVotes ? "succeeded" : "defeated";
}

export function useDaoConfig() {
  return useReadContracts({
    contracts: [
      { ...dao, functionName: "proposalThreshold" },
      { ...dao, functionName: "quorum" },
      { ...dao, functionName: "votingPeriod" },
      { ...dao, functionName: "votingDelay" },
      { ...dao, functionName: "proposalCount" },
    ],
    query: {
      enabled: DAO_DEPLOYED,
      select: (r) => ({
        threshold: Number(r[0].result ?? 1n),
        quorum: Number(r[1].result ?? 0n),
        period: Number(r[2].result ?? 0n),
        delay: Number(r[3].result ?? 0n),
        count: Number(r[4].result ?? 0n),
      }),
    },
  });
}

export function useProposals(count: number | undefined) {
  return useReadContract({
    ...dao,
    functionName: "getProposals",
    args: [0n, BigInt(count ?? 0)],
    query: {
      enabled: DAO_DEPLOYED && !!count,
      refetchInterval: 20_000,
      select: (list) =>
        list
          .map((p, i) => ({
            id: i,
            proposer: p.proposer,
            start: Number(p.start),
            end: Number(p.end),
            forVotes: p.forVotes,
            againstVotes: p.againstVotes,
            abstainVotes: p.abstainVotes,
            canceled: p.canceled,
            title: p.title,
            description: p.description,
          }))
          .reverse() as Proposal[],
    },
  });
}

export function useProposal(id: number) {
  return useReadContract({
    ...dao,
    functionName: "getProposal",
    args: [BigInt(id)],
    query: {
      enabled: DAO_DEPLOYED && Number.isInteger(id) && id >= 0,
      refetchInterval: 15_000,
      select: (p): Proposal => ({
        id,
        proposer: p.proposer,
        start: Number(p.start),
        end: Number(p.end),
        forVotes: p.forVotes,
        againstVotes: p.againstVotes,
        abstainVotes: p.abstainVotes,
        canceled: p.canceled,
        title: p.title,
        description: p.description,
      }),
    },
  });
}

/** tokenIds the connected wallet owns (server multicall, cached 60s) */
export function useMyTokens() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["myTokens", address],
    enabled: !!address,
    queryFn: async () => {
      const r = await fetch(`/api/dao/tokens?address=${address}`);
      const d = (await r.json()) as { tokenIds: number[] };
      return d.tokenIds ?? [];
    },
    staleTime: 30_000,
  });
}

export function useReceipt(id: number) {
  const { address } = useAccount();
  return useReadContract({
    ...dao,
    functionName: "receipt",
    args: [BigInt(id), address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: DAO_DEPLOYED && !!address },
  });
}

export function useUnusedTokens(id: number, tokenIds: number[] | undefined) {
  return useReadContract({
    ...dao,
    functionName: "unusedTokens",
    args: [BigInt(id), (tokenIds ?? []).map(BigInt)],
    query: {
      enabled: DAO_DEPLOYED && !!tokenIds?.length,
      select: (free) => (tokenIds ?? []).filter((_, i) => free[i]),
    },
  });
}

export const fmtDate = (t: number) =>
  new Date(t * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function timeLeft(end: number, now = Date.now() / 1000) {
  const s = Math.max(0, end - now);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h left`;
  if (h) return `${h}h ${m}m left`;
  return `${m}m left`;
}
