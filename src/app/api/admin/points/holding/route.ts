import { lastHoldingRun, runHoldingAccrual } from "@/lib/points/holding";
import { assertSameOrigin, handle, isCron, ok, requireAdmin } from "@/lib/points/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Passive holding accrual.
 *   GET  — Vercel cron (Authorization: Bearer CRON_SECRET). Add to vercel.json:
 *          { "path": "/api/admin/points/holding", "schedule": "5 0 * * *" }
 *   POST — an admin pressing "run holding" in /portal/admin.
 * Idempotent per tokenId per UTC day, so extra runs never double-pay.
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
