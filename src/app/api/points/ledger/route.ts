import { ledger } from "@/lib/points";
import { handle, ok, requireSession } from "@/lib/points/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const s = await requireSession();
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50) || 50;
  return ok({ entries: await ledger(s.address, limit) });
});
