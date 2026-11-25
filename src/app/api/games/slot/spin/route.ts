import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { spin, SpinError } from "@/games/slot/server";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

/**
 * POST { bet, clientSeed, serverSeedHash } → spin result + revealed seed.
 * Requires the SIWE session cookie. JSON-only, so cross-site form posts can't
 * reach it (and the session cookie is SameSite=Lax).
 */
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) {
    return NextResponse.json(
      { code: "unauthorized", error: "sign in with your wallet to play" },
      { status: 401, headers: noStore },
    );
  }
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ code: "bad-request", error: "send JSON" }, { status: 415, headers: noStore });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "bad-request", error: "invalid JSON" }, { status: 400, headers: noStore });
  }
  try {
    const result = await spin(s.address, {
      bet: body?.bet,
      clientSeed: body?.clientSeed,
      serverSeedHash: body?.serverSeedHash,
    });
    return NextResponse.json(result, { headers: noStore });
  } catch (e) {
    if (e instanceof SpinError) {
      const headers: Record<string, string> = { ...noStore };
      if (e.body.retryAfterMs) headers["retry-after"] = String(Math.ceil(e.body.retryAfterMs / 1000));
      return NextResponse.json(e.body, { status: e.status, headers });
    }
    console.error("[slot] spin failed", e);
    return NextResponse.json({ code: "server", error: "the machine jammed, try again" }, { status: 500, headers: noStore });
  }
}
