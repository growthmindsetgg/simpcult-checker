import { checkin } from "@/lib/points/checkin";
import { assertSameOrigin, handle, ok, requireSession } from "@/lib/points/http";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const s = await requireSession();
  const r = await checkin(s.address);
  return ok({ balance: r.balance, amount: r.entry.amount, streak: r.streak, duplicate: r.duplicate });
});
