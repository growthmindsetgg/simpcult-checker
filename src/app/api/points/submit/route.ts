import { submit, type SubmitInput } from "@/lib/points/submissions";
import { assertSameOrigin, handle, ok, readJson, requireSession } from "@/lib/points/http";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const s = await requireSession();
  const body = await readJson<SubmitInput>(req);
  const sub = await submit(s.address, {
    kind: body.kind,
    url: typeof body.url === "string" ? body.url : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    note: typeof body.note === "string" ? body.note : undefined,
    proof: Array.isArray(body.proof) ? body.proof.slice(0, 5).map(String) : undefined,
  });
  return ok({ submission: sub }, 201);
});
