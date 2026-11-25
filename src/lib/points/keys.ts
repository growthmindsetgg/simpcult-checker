import { P } from "./store";
import type { PoolId } from "./config";

/** every points key in one place — all lowercase addresses */
export const K = {
  bal: (a: string) => `${P}:bal:${a}`,
  ref: (dir: string, a: string, refId: string) => `${P}:ref:${dir}:${a}:${refId}`,
  ledger: (a: string) => `${P}:ledger:${a}`,
  pool: (season: number, pool: PoolId) => `${P}:pool:${season}:${pool}`,
  lb: (season: number) => `${P}:lb:${season}`,
  stats: (season: number) => `${P}:stats:${season}`,

  streak: (a: string) => `${P}:streak:${a}`,
  checkinTokens: (day: string) => `${P}:checkin:tokens:${day}`,
  holdingTokens: (day: string) => `${P}:holding:tokens:${day}`,
  holdingRun: (day: string) => `${P}:holding:run:${day}`,

  xHandle: (a: string) => `${P}:x:addr:${a}`, // address → handle
  xOwner: (handle: string) => `${P}:x:handle:${handle.toLowerCase()}`, // handle → address
  tweet: (id: string) => `${P}:tweet:${id}`, // status id → submission id

  sub: (id: string) => `${P}:sub:${id}`,
  subsPending: () => `${P}:subs:pending`,
  subsDone: () => `${P}:subs:done`,
  subsUser: (a: string) => `${P}:subs:user:${a}`,
  cap: (kind: string, a: string, day: string) => `${P}:cap:${kind}:${a}:${day}`,

  owners: () => `${P}:nft:owners`,
  settle: (season: number) => `${P}:settle:${season}`,
};
