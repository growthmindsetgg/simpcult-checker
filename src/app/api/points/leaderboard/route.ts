import { seasonAt } from "@/lib/points/config";
import { leaderboard } from "@/lib/points/season";
import { handle, ok } from "@/lib/points/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const q = Number(new URL(req.url).searchParams.get("season"));
  const season = Number.isSafeInteger(q) && q >= 1 ? q : Math.max(1, seasonAt());
  return ok({ season, rows: await leaderboard(season) });
});
