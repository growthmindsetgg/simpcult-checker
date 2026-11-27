import { lastHoldingRun, runHoldingAccrual } from "@/lib/points/holding";
import { assertSameOrigin, handle, isCron, ok, requireAdmin } from "@/lib/points/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily holding count (NFT-days) + any random snapshot that's due.
 *   GET  — Vercel cron (Authorization: Bearer CRON_SECRET), see vercel.json.
 *   POST — an admin pressing "count holding" in /portal/admin.
 * Idempotent per tokenId per UTC day, so extra runs never double-count.
 * Nothing is paid here: the holding drop pays once at season end.
 */
export const GET = handle(async (req: Request) => {
  if (!isCron(req)) {
    await requireAdmin();
    return ok({ last: await lastHoldingRun() });
  }
  return ok(await runHoldingAccrual());
});

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  await requireAdmin();
  return ok(await runHoldingAccrual());
});
