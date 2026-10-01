import { NextResponse } from "next/server";
import { parseSiweMessage, verifySiweMessage } from "viem/siwe";
import { getAddress, isHex } from "viem";
import { kv } from "@/lib/server/store";
import { publicClient, nftBalance } from "@/lib/server/chain";
import { setSessionCookie } from "@/lib/server/session";
import { CHAIN_ID, SITE } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Sign-In With Ethereum (EIP-4361) verification.
 * Checks: signature (EOA, ERC-1271 smart wallets, ERC-6492), domain binding,
 * chain id 143, nonce is ours + unused + unexpired, message not expired.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { message?: string; signature?: string }
    | null;
  if (!body?.message || !isHex(body.signature ?? "")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const parsed = parseSiweMessage(body.message);
  if (!parsed.address || !parsed.nonce) {
    return NextResponse.json({ error: "malformed siwe message" }, { status: 400 });
  }
  if (parsed.chainId !== CHAIN_ID) {
    return NextResponse.json({ error: "wrong chain — monad (143) only" }, { status: 400 });
  }

  // consume nonce (single use)
  const had = await kv().take(`nonce:${parsed.nonce}`);
  if (!had) {
    return NextResponse.json({ error: "nonce expired or already used — try again" }, { status: 401 });
  }

  const ok = await verifySiweMessage(publicClient, {
    message: body.message,
    signature: body.signature as `0x${string}`,
    domain: SITE.domain,
    nonce: parsed.nonce,
  });
  if (!ok) {
    return NextResponse.json({ error: "signature invalid" }, { status: 401 });
  }

  const address = getAddress(parsed.address);
  const balance = await nftBalance(address).catch(() => 0);
  await setSessionCookie({ address, method: "siwe", balance });
  return NextResponse.json({ address, balance, method: "siwe" });
}
