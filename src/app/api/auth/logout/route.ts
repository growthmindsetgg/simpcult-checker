import { clearSessionCookie } from "@/lib/server/session";
import { crossSite, fail, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (crossSite(req)) return fail(403, "cross-site request refused");
  await clearSessionCookie();
  return json({ ok: true });
}
