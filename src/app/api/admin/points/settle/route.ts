import { freezeSeason, getSettlement } from "@/lib/points/settlement";
import { assertSameOrigin, handle, HttpError, ok, readJson, requireAdmin } from "@/lib/points/http";

export const dynamic = "force-dynamic";

/** GET ?season=N → frozen snapshot (root + rows for settleBatch) */
export const GET = handle(async (req: Request) => {
  await requireAdmin();
  const season = Number(new URL(req.url).searchParams.get("season"));
  if (!Number.isSafeInteger(season) || season < 1) throw new HttpError(400, "bad season");
  return ok({ settlement: await getSettlement(season) });
});

/** { season, force? } → freeze the season's earned points into a merkle root (once) */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const s = await requireAdmin();
  const b = await readJson<{ season?: number; force?: boolean }>(req);
  const settlement = await freezeSeason(Number(b.season), s.address.toLowerCase(), { force: b.force === true });
  return ok({ settlement });
});
