import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { nftBalance } from "@/lib/server/chain";
import { issueCode } from "@/lib/server/telegram";

export const dynamic = "force-dynamic";

const USERNAME_RE = /^[A-Za-z0-9_]{5,32}$/;

/** Verified holder → short code → t.me deep link. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "verify your wallet first" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { username?: string } | null;
  const raw = (body?.username ?? "").trim().replace(/^@/, "");
  if (!raw || !USERNAME_RE.test(raw)) {
    return NextResponse.json(
      { error: "enter your telegram @username (5–32 letters, digits, underscore)" },
      { status: 400 },
    );
  }

  const balance = await nftBalance(s.address).catch(() => 0);
  if (balance < 1)
    return NextResponse.json(
      { error: "this wallet holds no simp cult nft", balance },
      { status: 403 },
    );

  const botName = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
  if (!botName) return NextResponse.json({ error: "telegram bot not configured" }, { status: 503 });

  const code = await issueCode(s.address, raw);
  return NextResponse.json({ url: `https://t.me/${botName}?start=${code}`, balance, expiresIn: 600, username: raw });
}
