import { emit, revokeEmission } from "@/lib/points/ledger";
import { POOLS, seasonAt, type PoolId } from "@/lib/points/config";
import { getSettlement } from "@/lib/points/settlement";
import { assertSameOrigin, handle, HttpError, ok, readJson, requireAdmin } from "@/lib/points/http";

export const dynamic = "force-dynamic";

/**
 * Manual grant / revoke from a pool (corrections, events, contest prizes).
 * { address, amount, pool, note, mode: "grant" | "revoke", refId, season? }
 * refId is required (the UI sends one per form) so a double-click or a retry
 * can't double-pay. A revoke debits `season`'s pool and leaderboard (default:
 * the current season) — name the season the points were earned in.
 */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const s = await requireAdmin();
  const b = await readJson<{ address?: string; amount?: number; pool?: string; note?: string; mode?: string; refId?: string; season?: number }>(req);
  const pool = b.pool as PoolId;
  if (!POOLS.includes(pool)) throw new HttpError(400, "pick a pool");
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) : "";
  if (note.length < 3) throw new HttpError(400, "add a short note (it shows in the ledger)");
  if (typeof b.refId !== "string" || !/^[\w-]{8,64}$/.test(b.refId)) {
    throw new HttpError(400, "send a refId (8–64 letters, digits, - or _) so a retry can't apply twice", "no_ref");
  }
  const refId = `admin:${b.refId}`;
  const meta = { by: s.address.toLowerCase(), note };
  const amount = Number(b.amount);
  if (b.mode === "revoke") {
    const season = b.season === undefined || b.season === null ? seasonAt() : Number(b.season);
    if (!Number.isSafeInteger(season) || season < 1 || season > seasonAt()) throw new HttpError(400, "bad season");
    // a frozen season's snapshot is what settles onchain; it can't change under it
    if (await getSettlement(season)) {
      throw new HttpError(409, `season ${season} is already frozen for settlement`, "season_frozen");
    }
    const r = await revokeEmission(pool, String(b.address), amount, "admin:revoke", refId, { ...meta, season }, season);
    return ok({ balance: r.balance, entry: r.entry, duplicate: r.duplicate });
  }
  const r = await emit(pool, String(b.address), amount, "admin:grant", refId, meta);
  return ok({ balance: r.balance, entry: r.entry, duplicate: r.duplicate });
});
