import { approve, reject } from "@/lib/points/submissions";
import { assertSameOrigin, handle, HttpError, ok, readJson, requireAdmin } from "@/lib/points/http";

export const dynamic = "force-dynamic";

/** { id, action: "approve" | "reject", amount?, note? } */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const s = await requireAdmin();
  const b = await readJson<{ id?: string; action?: string; amount?: number; note?: string }>(req);
  if (typeof b.id !== "string") throw new HttpError(400, "missing id");
  const by = s.address.toLowerCase();
  const note = typeof b.note === "string" ? b.note : undefined;
  if (b.action === "approve") {
    const amount = b.amount === undefined || b.amount === null ? undefined : Number(b.amount);
    return ok({ submission: await approve(b.id, { by, amount, note }) });
  }
  if (b.action === "reject") return ok({ submission: await reject(b.id, { by, note }) });
  throw new HttpError(400, "action must be approve or reject");
});
