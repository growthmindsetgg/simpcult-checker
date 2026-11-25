import { claimHandle, verifyHandle } from "@/lib/points/xhandle";
import { assertSameOrigin, handle, HttpError, ok, readJson, requireSession } from "@/lib/points/http";

export const dynamic = "force-dynamic";

/** { handle } → claim (returns a code to post) · { url } → verify via that post */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const s = await requireSession();
  const body = await readJson<{ handle?: string; url?: string }>(req);
  const x = body.url
    ? await verifyHandle(s.address, body.url)
    : body.handle
      ? await claimHandle(s.address, body.handle)
      : null;
  if (!x) throw new HttpError(400, "send a handle or a post url");
  return ok({ handle: x.handle, verified: x.verified, code: x.verified ? undefined : x.code });
});
