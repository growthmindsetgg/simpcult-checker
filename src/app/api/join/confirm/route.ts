import { NextResponse } from "next/server";
import { getAddress, isAddress, isHex, type Hex } from "viem";
import { kv } from "@/lib/server/store";
import { publicClient, nftBalance } from "@/lib/server/chain";
import { setSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

type Challenge = { amountWei: string; amountMon: string; expiresAt: number };

/**
 * Confirm the self-transaction for a wallet.
 *
 * Body: { address: "0x…", hash: "0x…" }
 *
 * Checks against the stored challenge:
 *  - tx hash exists, mined, status === "success"
 *  - from == to == address (self-send)
 *  - value matches the exact amountWei
 *  - block timestamp within the 15-minute window (expiresAt)
 *
 * On success: sets the signed session cookie (method "tx"), consumes the
 * challenge, returns { address, balance, method }.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { address?: string; hash?: string } | null;
  if (!body?.address || !isAddress(body.address, { strict: false })) {
    return NextResponse.json({ error: "connect a wallet first" }, { status: 401 });
  }
  if (!body.hash || !isHex(body.hash)) {
    return NextResponse.json({ error: "paste the transaction hash" }, { status: 400 });
  }

  const address = getAddress(body.address);
  const key = `join:tx:${address.toLowerCase()}`;
  const challenge = await kv().get<Challenge>(key);
  if (!challenge) {
    return NextResponse.json({ error: "challenge expired — request a new amount" }, { status: 401 });
  }

  const receipt = await publicClient.getTransactionReceipt({ hash: body.hash as Hex }).catch(() => null);
  if (!receipt || receipt.status !== "success") {
    return NextResponse.json({ error: "transaction not found or not mined yet" }, { status: 409 });
  }
  const tx = await publicClient.getTransaction({ hash: body.hash as Hex });

  if (
    !tx.to ||
    getAddress(tx.from) !== address ||
    getAddress(tx.to) !== address ||
    tx.value.toString() !== challenge.amountWei
  ) {
    return NextResponse.json({ error: "transaction does not match the challenge" }, { status: 401 });
  }

  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const tsMs = Number(block.timestamp) * 1000;
  if (tsMs > challenge.expiresAt || tsMs < challenge.expiresAt - 15 * 60 * 1000) {
    return NextResponse.json({ error: "transaction outside the 15-minute window" }, { status: 401 });
  }

  await kv().del(key); // consume only after full validation
  const balance = await nftBalance(address).catch(() => 0);
  if (balance < 1) {
    return NextResponse.json(
      { error: "this wallet holds no simp cult nft", balance },
      { status: 403 },
    );
  }
  await setSessionCookie({ address, method: "tx", balance });
  return NextResponse.json({ address, balance, method: "tx" });
}
