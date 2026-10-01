import "server-only";
import { createPublicClient, http, type Address, parseAbi } from "viem";
import { CHAIN, NFT_ADDRESS } from "@/lib/config";

/** Server-side RPC. Use a private/paid endpoint here if you have one. */
export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(process.env.MONAD_RPC ?? process.env.NEXT_PUBLIC_MONAD_RPC ?? "https://rpc.monad.xyz", {
    batch: true,
    retryCount: 2,
  }),
});

export const erc721Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function name() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

export async function nftBalance(owner: Address): Promise<number> {
  const bal = await publicClient.readContract({
    address: NFT_ADDRESS,
    abi: erc721Abi,
    functionName: "balanceOf",
    args: [owner],
  });
  return Number(bal);
}
