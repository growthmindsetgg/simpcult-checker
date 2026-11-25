/**
 * Provably fair commit–reveal, shared by server and browser (WebCrypto only).
 *
 *  1. Before you spin, the server picks a random 32-byte `serverSeed` and shows
 *     you only `serverSeedHash = sha256(serverSeed)`.
 *  2. You send your own `clientSeed` with the spin. The server can't change its
 *     seed any more (the hash is locked in), and it didn't know your seed when
 *     it picked its own.
 *  3. Outcome bytes = HMAC-SHA256(key = serverSeed, msg = "simp-machine:v1:" + clientSeed).
 *     Byte r (low 6 bits) is reel r's stop on the published strip.
 *  4. After the spin the server reveals `serverSeed`. Anyone can check the hash
 *     and recompute the exact grid and payout with `verifySpin`.
 *
 * Each server seed is used for exactly one spin, then a fresh one is committed.
 * The browser likewise sends a NEW client seed every spin, chosen after it has
 * seen the commitment, so the server never picks a seed knowing yours.
 */
import { FAIRNESS_VERSION } from "./config";
import { resolveFromBytes, type SpinOutcome } from "./engine";

const enc = new TextEncoder();

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto is not available in this environment");
  return s;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function randomHex(byteLength = 32): string {
  const b = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(b);
  return toHex(b);
}

export async function sha256Hex(input: string): Promise<string> {
  const d = await subtle().digest("SHA-256", enc.encode(input));
  return toHex(new Uint8Array(d));
}

export function fairMessage(clientSeed: string): string {
  return `${FAIRNESS_VERSION}:${clientSeed}`;
}

export async function outcomeBytes(serverSeed: string, clientSeed: string): Promise<Uint8Array> {
  const key = await subtle().importKey("raw", enc.encode(serverSeed), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await subtle().sign("HMAC", key, enc.encode(fairMessage(clientSeed)));
  return new Uint8Array(sig);
}

/** Client seeds: 8–64 chars of [A-Za-z0-9_-]. Short enough to log, long enough to be yours. */
export const CLIENT_SEED_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const SERVER_SEED_RE = /^[0-9a-f]{64}$/;

export type VerifyInput = {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  bet: number;
  /** what the server claimed */
  stops: number[];
  totalWin: number;
};

export type VerifyResult = {
  hashOk: boolean;
  outcomeOk: boolean;
  recomputed: SpinOutcome;
};

export async function verifySpin(v: VerifyInput): Promise<VerifyResult> {
  const hashOk = (await sha256Hex(v.serverSeed)) === v.serverSeedHash.toLowerCase();
  const recomputed = resolveFromBytes(await outcomeBytes(v.serverSeed, v.clientSeed), v.bet);
  const outcomeOk =
    recomputed.totalWin === v.totalWin &&
    recomputed.stops.length === v.stops.length &&
    recomputed.stops.every((s, i) => s === v.stops[i]);
  return { hashOk, outcomeOk, recomputed };
}
