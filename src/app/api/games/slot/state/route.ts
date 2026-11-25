import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getState } from "@/games/slot/server";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

/** Balance, the next spin's server-seed hash, and recent spins (with revealed seeds). */
export async function GET() {
  const s = await getSession();
  if (!s) {
    return NextResponse.json(
      { code: "unauthorized", error: "sign in with your wallet to play" },
      { status: 401, headers: noStore },
    );
  }
  try {
    return NextResponse.json(await getState(s.address), { headers: noStore });
  } catch (e) {
    console.error("[slot] state failed", e);
    return NextResponse.json({ code: "server", error: "couldn't load the machine, try again" }, { status: 500, headers: noStore });
  }
}
