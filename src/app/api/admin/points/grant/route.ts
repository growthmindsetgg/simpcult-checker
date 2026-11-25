import { randomUUID } from "node:crypto";
import { emit, revokeEmission } from "@/lib/points/ledger";
import { POOLS, type PoolId } from "@/lib/points/config";
import { assertSameOrigin, handle, HttpError, ok, readJson, requireAdmin } from "@/lib/points/http";

export const dynamic = "force-dynamic";

/**
 * Manual grant / revoke from a pool (corrections, events, contest prizes).
 * { address, amount, pool, note, mode: "grant" | "revoke", refId? }
 * Pass a refId (the UI sends one per form) so a double-click can't double-pay.
 */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const s = await requireAdmin();
  const b = await readJson<{ address?: string; amount?: number; pool?: string; note?: string; mode?: string; refId?: string }>(req);
  const pool = b.pool as PoolId;
  if (!POOLS.includes(pool)) throw new HttpError(400, "pick a pool");
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) : "";
  if (note.length < 3) throw new HttpError(400, "add a short note (it shows in the ledger)");
  const refId = `admin:${typeof b.refId === "string" && /^[\w-]{8,64}$/.test(b.refId) ? b.refId : randomUUID()}`;
  const meta = { by: s.address.toLowerCase(), note };
  const amount = Number(b.amount);
  const r =
    b.mode === "revoke"
      ? await revokeEmission(pool, String(b.address), amount, "admin:revoke", refId, meta)
      : await emit(pool, String(b.address), amount, "admin:grant", refId, meta);
  return ok({ balance: r.balance, entry: r.entry, duplicate: r.duplicate });
});
