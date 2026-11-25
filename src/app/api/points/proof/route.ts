import { proofFor } from "@/lib/points/settlement";
import { handle, HttpError, ok, requireSession } from "@/lib/points/http";

export const dynamic = "force-dynamic";

/** merkle proof to claim a settled season's XP onchain */
export const GET = handle(async (req: Request) => {
  const s = await requireSession();
  const season = Number(new URL(req.url).searchParams.get("season"));
  if (!Number.isSafeInteger(season) || season < 1) throw new HttpError(400, "bad season");
  const p = await proofFor(s.address, season);
  if (!p) throw new HttpError(404, `season ${season} isn't settled yet`, "not_settled");
  return ok(p);
});
