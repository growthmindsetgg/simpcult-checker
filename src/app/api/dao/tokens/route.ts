import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { publicClient, erc721Abi } from "@/lib/server/chain";
import { NFT_ADDRESS } from "@/lib/config";
import { kv } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/**
 * tokenIds owned by an address — needed because SimpDAO votes per tokenId.
 * The collection is small (~421), so we multicall ownerOf over the id range
 * and cache the owner map for 60s. Works without ERC721Enumerable.
 */
async function ownerMap(): Promise<Record<string, number[]>> {
  const cached = await kv().get<Record<string, number[]>>("nft:owners");
  if (cached) return cached;

  let supply = 0;
  try {
    supply = Number(
      await publicClient.readContract({ address: NFT_ADDRESS, abi: erc721Abi, functionName: "totalSupply" }),
    );
  } catch {
    supply = Number(process.env.NFT_MAX_SUPPLY ?? 1000);
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
  results.forEach((r, i) => {
    if (r.status === "success") {
      const o = (r.result as string).toLowerCase();
      (map[o] ??= []).push(ids[i]);
    }
  });
  await kv().set("nft:owners", map, 60);
  return map;
}

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!isAddress(address)) return NextResponse.json({ error: "bad address" }, { status: 400 });
  const map = await ownerMap();
  const tokenIds = map[getAddress(address).toLowerCase()] ?? [];
  return NextResponse.json({ address, tokenIds }, { headers: { "cache-control": "no-store" } });
}
