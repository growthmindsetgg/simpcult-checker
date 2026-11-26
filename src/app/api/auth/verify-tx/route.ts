import { NextResponse } from "next/server";
import { getAddress, isHex, stringToHex, type Hex } from "viem";
import { consumeNonce } from "@/lib/server/nonce";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { publicClient, nftBalance } from "@/lib/server/chain";
import { setSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Alternative proof-of-ownership for wallets that can't sign messages
 * (some hardware / exchange-hosted / multisig setups):
 * the user sends a 0-MON transaction FROM their address TO their own address
 * with the nonce in calldata. We check the mined receipt.
 *
 * The nonce is public once the transaction is broadcast, so it is not a
 * secret: what ties it to the caller is the httpOnly nonce cookie set when it
 * was issued. The nonce is spent before any chain read, so a `{hash, nonce}`
 * pair can produce at most one session, and only in the browser that asked.
 */
export async function POST(req: Request) {
  if (!(await rateLimit("verify-tx", clientIp(req), 10, 60))) {
    return NextResponse.json({ error: "too many attempts — wait a minute" }, { status: 429, headers: { "retry-after": "60" } });
  }
  const body = (await req.json().catch(() => null)) as { hash?: string; nonce?: string } | null;
  if (!body?.hash || !isHex(body.hash) || !body.nonce || !/^[0-9a-f]{32}$/.test(body.nonce)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (!(await consumeNonce(body.nonce))) {
    return NextResponse.json({ error: "nonce expired or already used — try again" }, { status: 401 });
  }

  // the nonce is already spent, so give a just-sent transaction a moment to land
  const receipt = await publicClient
    .waitForTransactionReceipt({ hash: body.hash as Hex, timeout: 8_000 })
    .catch(() => null);
  if (!receipt || receipt.status !== "success") {
    return NextResponse.json({ error: "transaction not found or not mined yet" }, { status: 409 });
  }
  const tx = await publicClient.getTransaction({ hash: body.hash as Hex });

  const expectedData = stringToHex(`simpcult:${body.nonce}`);
  if (
    !tx.to ||
    getAddress(tx.from) !== getAddress(tx.to) ||
    tx.value !== 0n ||
    tx.input.toLowerCase() !== expectedData.toLowerCase()
  ) {
    return NextResponse.json({ error: "transaction does not match the verification template" }, { status: 401 });
  }

  // receipt must be recent (within ~30 min) so old txs can't be replayed
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  if (Number(block.timestamp) * 1000 < Date.now() - 30 * 60 * 1000) {
    return NextResponse.json({ error: "transaction too old" }, { status: 401 });
  }

  const address = getAddress(tx.from);
  const balance = await nftBalance(address).catch(() => 0);
  await setSessionCookie({ address, method: "tx", balance });
  return NextResponse.json({ address, balance, method: "tx" });
}
