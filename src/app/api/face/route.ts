import { NextResponse } from "next/server";
import { parseAbi } from "viem";
import { publicClient } from "@/lib/server/chain";
import { NFT_ADDRESS } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/face?id=<tokenId>: a Simp Cult NFT's image, same-origin.
 *
 * Why it exists: the slot's 3D reels draw faces into a WebGL texture, which
 * needs CORS-clean pixels, and the browser can't read the metadata JSON at all
 * under our CSP (connect-src 'self'). The metadata's own image host (ipfs.io)
 * answers 429 to most requests, so we read through pinned IPFS gateways.
 *
 * Not an open proxy: the only input is an integer token id. The metadata URL
 * comes from the contract's tokenURI, both it and the image must be IPFS paths
 * (ipfs://CID/... or an /ipfs/CID/... gateway URL), and they're refetched only
 * from the fixed gateway list below, without following redirects, with a
 * timeout and a byte cap. Only png / jpeg / webp / gif bodies are passed on
 * (never SVG), with nosniff.
 */

const GATEWAYS = ["https://gateway.pinata.cloud/ipfs/", "https://ipfs.filebase.io/ipfs/", "https://ipfs.io/ipfs/"];
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_ID = 10_000; // the collection is ~421 tokens; leave room to grow
const META_MAX = 64 * 1024;
const IMAGE_MAX = 2 * 1024 * 1024;
const TIMEOUT_MS = 6000;
/** CIDv0 (Qm…) or CIDv1 base32 (b…), then an optional plain path */
const IPFS_PATH = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,100})((?:\/[\w.-]{1,80}){0,4})$/;

const abi = parseAbi(["function tokenURI(uint256 tokenId) view returns (string)"]);

type Cached = { body: Uint8Array; type: string; at: number };
const cache = new Map<number, Cached>();
const CACHE_MS = 6 * 60 * 60 * 1000; // the collection's base URI is mutable, so nothing is cached forever
const CACHE_MAX = 64;
/** ids that just failed (no such token, gateway down): answered from memory for a while */
const misses = new Map<number, number>();
const MISS_MS = 10 * 60 * 1000;
const miss = (id: number, status: number, error: string) => {
  misses.set(id, Date.now());
  if (misses.size > 512) misses.delete(misses.keys().next().value as number);
  return fail(status, error);
};

/** "ipfs://CID/path" or "https://<any gateway>/ipfs/CID/path" → "CID/path", else null */
function ipfsPath(uri: string): string | null {
  let rest: string | null = null;
  if (uri.startsWith("ipfs://")) rest = uri.slice(7).replace(/^ipfs\//, "");
  else {
    try {
      const u = new URL(uri);
      if (u.protocol === "https:" && u.pathname.startsWith("/ipfs/") && !u.search && !u.hash) rest = u.pathname.slice(6);
    } catch {
      return null;
    }
  }
  return rest && IPFS_PATH.test(rest) ? rest : null;
}

/** fetch an IPFS path from the first gateway that answers; body capped at `max` bytes */
async function fromIpfs(path: string, max: number, accept: (type: string) => boolean): Promise<{ body: Uint8Array; type: string } | null> {
  for (const gw of GATEWAYS) {
    try {
      const r = await fetch(gw + path, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
      if (!r.ok || !r.body) continue;
      const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!accept(type)) continue;
      const declared = Number(r.headers.get("content-length") ?? 0);
      if (declared > max) continue;
      const reader = r.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      let over = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
          over = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      if (over) continue;
      const body = new Uint8Array(size);
      let o = 0;
      for (const c of chunks) {
        body.set(c, o);
        o += c.byteLength;
      }
      return { body, type };
    } catch {
      /* next gateway */
    }
  }
  return null;
}

const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^\d{1,5}$/.test(raw)) return fail(400, "bad id");
  const id = Number(raw);
  if (id > MAX_ID) return fail(400, "bad id");

  const missedAt = misses.get(id);
  if (missedAt && Date.now() - missedAt < MISS_MS) return fail(404, "not available");

  let hit = cache.get(id);
  if (!hit || Date.now() - hit.at > CACHE_MS) {
    let uri: string;
    try {
      uri = await publicClient.readContract({ address: NFT_ADDRESS, abi, functionName: "tokenURI", args: [BigInt(id)] });
    } catch {
      return miss(id, 404, "no such token");
    }
    const metaPath = ipfsPath(uri);
    if (!metaPath) return miss(id, 502, "unsupported metadata location");
    const meta = await fromIpfs(metaPath, META_MAX, (t) => t === "application/json" || t === "text/plain" || t === "application/octet-stream");
    if (!meta) return miss(id, 502, "metadata unavailable");
    let image: unknown;
    try {
      image = (JSON.parse(new TextDecoder().decode(meta.body)) as { image?: unknown }).image;
    } catch {
      return miss(id, 502, "bad metadata");
    }
    const imgPath = typeof image === "string" ? ipfsPath(image) : null;
    if (!imgPath) return miss(id, 502, "unsupported image location");
    const img = await fromIpfs(imgPath, IMAGE_MAX, (t) => IMAGE_TYPES.has(t));
    if (!img) return miss(id, 502, "image unavailable");
    hit = { ...img, at: Date.now() };
    cache.set(id, hit);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as number);
  }

  return new NextResponse(new Blob([hit.body as BlobPart], { type: hit.type }), {
    headers: {
      "content-type": hit.type,
      "content-length": String(hit.body.byteLength),
      "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
