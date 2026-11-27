import { P } from "./store";
import type { BucketId } from "./config";

/**
 * Every points key in one place — all lowercase addresses.
 *
 * Key strategy for rules v2 (2026-11-27): existing prefixes keep their
 * meaning; new state gets new prefixes, nothing is renamed in place.
 *   - `pool:<s>:<bucket>` is the INSTANT emission counter. `active` and
 *     `holding` are the same keys as before (old daily holding payouts stay
 *     counted there and are subtracted from the holding drop). The community
 *     pool's sub-pools are new keys `pool:<s>:card` / `pool:<s>:amu`; the old
 *     `pool:<s>:monad` key is no longer written (it only ever held test grants).
 *   - `poolend:<s>:<bucket>` counts season-end payouts (capped at the pot).
 *   - `lbb:<s>:<bucket>` is season points earned per bucket (pro-rata basis).
 */
export const K = {
  bal: (a: string) => `${P}:bal:${a}`,
  ref: (dir: string, a: string, refId: string) => `${P}:ref:${dir}:${a}:${refId}`,
  ledger: (a: string) => `${P}:ledger:${a}`,
  pool: (season: number, bucket: BucketId) => `${P}:pool:${season}:${bucket}`,
  poolEnd: (season: number, bucket: BucketId) => `${P}:poolend:${season}:${bucket}`,
  lb: (season: number) => `${P}:lb:${season}`,
  lbBucket: (season: number, bucket: BucketId) => `${P}:lbb:${season}:${bucket}`,
  stats: (season: number) => `${P}:stats:${season}`,

  streak: (a: string) => `${P}:streak:${a}`,
  checkinTokens: (day: string) => `${P}:checkin:tokens:${day}`,
  holdingTokens: (day: string) => `${P}:holding:tokens:${day}`,
  holdingRun: (day: string) => `${P}:holding:run:${day}`,
  /** zset owner → NFT-days counted this season, + the season total */
  nftDays: (season: number) => `${P}:nftdays:${season}`,
  nftDaysTotal: (season: number) => `${P}:nftdays:${season}:total`,

  /** list of taken snapshot records (newest first) + count + lock */
  snaps: (season: number) => `${P}:snap:${season}`,
  snapCount: (season: number) => `${P}:snap:${season}:n`,
  snapLock: (season: number) => `${P}:snap:${season}:lock`,
  /** set of wallets that were missing at a snapshot: no holding drop */
  holdOut: (season: number) => `${P}:holdout:${season}`,

  /** final-48h post: address → approved submission id; set of posters */
  seasonPost: (season: number, a: string) => `${P}:spost:${season}:${a}`,
  seasonPosters: (season: number) => `${P}:spost:${season}:all`,

  /** cached Monad transaction count */
  txCount: (a: string) => `${P}:txc:${a}`,

  /** welcome bonus: first time we saw each token in the wallet; tokens already used; on-chain check cooldown */
  welcomeSeen: (a: string) => `${P}:welcome:seen:${a}`,
  welcomeTokens: () => `${P}:welcome:tokens`,
  welcomeCheck: (a: string) => `${P}:welcome:chk:${a}`,

  xHandle: (a: string) => `${P}:x:addr:${a}`, // address → handle
  xOwner: (handle: string) => `${P}:x:handle:${handle.toLowerCase()}`, // handle → address
  tweet: (id: string) => `${P}:tweet:${id}`, // status id → submission id

  sub: (id: string) => `${P}:sub:${id}`,
  subsPending: () => `${P}:subs:pending`,
  subsDone: () => `${P}:subs:done`,
  subsUser: (a: string) => `${P}:subs:user:${a}`,
  cap: (kind: string, a: string, day: string) => `${P}:cap:${kind}:${a}:${day}`,
  /** set of `${tokenId}:${slot}` — the daily submission slots each NFT has used */
  subTokens: (kind: string, day: string) => `${P}:subtok:${kind}:${day}`,

  /** auto-pace, per season / bucket / UTC day: allowance record, instant paid, weight units (zset + total), close plan */
  paceDay: (season: number, bucket: BucketId, day: string) => `${P}:pace:${season}:${bucket}:${day}`,
  paceSpent: (season: number, bucket: BucketId, day: string) => `${P}:pace:${season}:${bucket}:${day}:spent`,
  paceUnits: (season: number, bucket: BucketId, day: string) => `${P}:pace:${season}:${bucket}:${day}:units`,
  paceUnitsTotal: (season: number, bucket: BucketId, day: string) => `${P}:pace:${season}:${bucket}:${day}:units:n`,
  /** zset: instant points each wallet got that day (for the per-wallet daily cap) */
  paceInstant: (season: number, bucket: BucketId, day: string) => `${P}:pace:${season}:${bucket}:${day}:instant`,
  paceClose: (season: number, bucket: BucketId, day: string) => `${P}:pace:${season}:${bucket}:${day}:close`,
  paceCursor: (season: number, bucket: BucketId, day: string) => `${P}:pace:${season}:${bucket}:${day}:cursor`,
  paceLock: (season: number, bucket: BucketId, day: string) => `${P}:pace:${season}:${bucket}:${day}:lock`,
  /** welcome bonuses paid from a bucket this season */
  welcomePaid: (season: number, bucket: BucketId) => `${P}:welcome:paid:${season}:${bucket}`,

  owners: () => `${P}:nft:owners`,
  settle: (season: number) => `${P}:settle:${season}`,
  /** index of the next season-end share to credit after a freeze */
  payoutCursor: (season: number) => `${P}:settle:${season}:cursor`,
};
