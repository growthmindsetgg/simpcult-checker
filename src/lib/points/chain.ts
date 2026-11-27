import "server-only";
import { getAddress, parseAbi, type Address } from "viem";
import { publicClient, erc721Abi, nftBalance } from "@/lib/server/chain";
import { NFT_ADDRESS } from "@/lib/config";
import { MONAD_CARD_ENABLED, POINTS_CONFIG } from "./config";
import { store } from "./store";
import { K } from "./keys";

export { nftBalance };

/** never real holders: skipped by holding counts and snapshots */
export const SKIP_OWNERS = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

/**
 * owner → tokenIds for the whole Simp Cult collection. ~421 tokens, so one
 * multicall of ownerOf over the id range; cached 60s. Works without
 * ERC721Enumerable. Mirrors /api/dao/tokens (whose helper isn't exported).
 */
export async function ownerMap(opts: { fresh?: boolean } = {}): Promise<Record<string, number[]>> {
  if (!opts.fresh) {
    const cached = await store().get<Record<string, number[]>>(K.owners());
    if (cached) return cached;
  }
  let supply = POINTS_CONFIG.holding.nftSupply;
  try {
    supply = Number(
      await publicClient.readContract({ address: NFT_ADDRESS, abi: erc721Abi, functionName: "totalSupply" }),
    );
  } catch {
    /* fall back to config */
  }
  // ids may be 0- or 1-based; probe 0..supply inclusive
  const ids = Array.from({ length: supply + 1 }, (_, i) => i);
  const results = await publicClient.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({
      address: NFT_ADDRESS,
      abi: erc721Abi,
      functionName: "ownerOf" as const,
      args: [BigInt(id)] as const,
    })),
  });
  const map: Record<string, number[]> = {};
  let ok = 0;
  results.forEach((r, i) => {
    if (r.status === "success") {
      ok++;
      const o = (r.result as string).toLowerCase();
      (map[o] ??= []).push(ids[i]);
    }
  });
  if (ok === 0) throw new Error("couldn't read NFT owners from chain");
  await store().set(K.owners(), map, { ex: 60 });
  return map;
}

/** tokenIds currently held by `addr` (live-ish: ≤60s cache) */
export async function tokensOf(addr: Address | string): Promise<number[]> {
  const map = await ownerMap();
  return map[addr.toLowerCase()] ?? [];
}

const erc1155Abi = parseAbi(["function balanceOf(address account, uint256 id) view returns (uint256)"]);

/** Monad card balance; 0 while the card contract is unconfigured */
export async function monadCardBalance(addr: Address | string): Promise<number> {
  if (!MONAD_CARD_ENABLED) return 0;
  const c = POINTS_CONFIG.monadCard;
  const owner = getAddress(addr);
  if (c.standard === "erc1155") {
    const b = await publicClient.readContract({
      address: c.address,
      abi: erc1155Abi,
      functionName: "balanceOf",
      args: [owner, c.tokenId],
    });
    return Number(b);
  }
  const b = await publicClient.readContract({
    address: c.address,
    abi: erc721Abi,
    functionName: "balanceOf",
    args: [owner],
  });
  return Number(b);
}

/**
 * Did `addr` own any of `tokenIds` at the latest block at least `minAgeMs`
 * old? One historical multicall (Monad's public RPC serves eth_call at past
 * blocks; log scans are capped at ~100 blocks, so Transfer history is out).
 * The block is found by estimating from the recent block time, then checked
 * by its timestamp. Returns the tokenIds owned then.
 */
export async function ownedAtAge(addr: string, tokenIds: number[], minAgeMs: number): Promise<number[]> {
  if (tokenIds.length === 0) return [];
  const latest = await publicClient.getBlock();
  const recent = await publicClient.getBlock({ blockNumber: latest.number - BigInt(1000) });
  const msPerBlock = Math.max(50, (Number(latest.timestamp - recent.timestamp) * 1000) / 1000);
  const cutoffSec = BigInt(Math.floor((Date.now() - minAgeMs) / 1000));
  let back = BigInt(Math.ceil((minAgeMs * 1.05) / msPerBlock) + 10);
  let block = await publicClient.getBlock({ blockNumber: latest.number - back });
  for (let i = 0; i < 3 && block.timestamp > cutoffSec; i++) {
    back = back * BigInt(2);
    block = await publicClient.getBlock({ blockNumber: latest.number - back });
  }
  if (block.timestamp > cutoffSec) return [];
  const results = await publicClient.multicall({
    allowFailure: true,
    blockNumber: block.number,
    contracts: tokenIds.map((id) => ({
      address: NFT_ADDRESS,
      abi: erc721Abi,
      functionName: "ownerOf" as const,
      args: [BigInt(id)] as const,
    })),
  });
  const a = addr.toLowerCase();
  return tokenIds.filter((_, i) => {
    const r = results[i];
    return r.status === "success" && String(r.result).toLowerCase() === a;
  });
}
