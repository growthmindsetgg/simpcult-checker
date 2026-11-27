import "server-only";
import { POINTS_CONFIG, type BucketId } from "./config";
import { emit, type Receipt } from "./ledger";
import { telegramBound } from "./telegram";
import { isShareBucket, quote, recordActivity } from "./pace";

/**
 * Activity payouts (check-ins, X / simp posts, alpha), auto-paced.
 *
 * weight units = base reward (the reward table, season-scaled) × Telegram
 * multiplier (3 when bound, read at payout time). The wallet gets the
 * day's instant amount for those units right away (pace.ts) and the units
 * count toward that day's split at UTC day close. The instant amount goes
 * through the atomic instant-cap check like any emission.
 * Welcome bonuses and admin grants call `emit` directly: flat, never paced,
 * never multiplied.
 */
export async function payActivity(
  bucket: BucketId,
  address: string,
  base: number,
  reason: string,
  refId: string,
  meta: Record<string, unknown> = {},
): Promise<Receipt & { multiplier: number; units: number }> {
  const multiplier = (await telegramBound(address)) ? POINTS_CONFIG.telegramMultiplier : 1;
  const units = base * multiplier;
  if (!isShareBucket(bucket)) {
    const r = await emit(bucket, address, units, reason, refId, { ...meta, base, multiplier });
    return { ...r, multiplier, units };
  }
  const q = await quote(bucket, units, address);
  const r = await emit(bucket, address, q.instant, reason, refId, {
    ...meta,
    base,
    multiplier,
    units,
    day: q.day.day,
    ...(q.throttled ? { throttled: true } : {}),
  });
  if (!r.duplicate) await recordActivity(q.day, address, units, q.instant);
  return { ...r, multiplier, units: r.duplicate ? Number(r.entry.meta?.units ?? units) : units };
}
