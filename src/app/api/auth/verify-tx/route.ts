import { NextResponse } from "next/server";
import { getAddress, isHex, stringToHex, type Hex } from "viem";
import { kv } from "@/lib/server/store";
import { publicClient, nftBalance } from "@/lib/server/chain";
import { setSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Alternative proof-of-ownership for wallets that can't sign messages
 * (some hardware / exchange-hosted / multisig setups):
 * the user sends a 0-MON transaction FROM their address TO their own address
 * with the nonce in calldata. We check the mined receipt.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { hash?: string; nonce?: string } | null;
  if (!body?.hash || !isHex(body.hash) || !body.nonce || !/^[0-9a-f]{32}$/.test(body.nonce)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const nonceKey = `nonce:${body.nonce}`;
  if (!(await kv().get(nonceKey))) {
    return NextResponse.json({ error: "nonce expired or already used — try again" }, { status: 401 });
  }

  const receipt = await publicClient.getTransactionReceipt({ hash: body.hash as Hex }).catch(() => null);
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

  await kv().del(nonceKey); // consume only after full validation
  const address = getAddress(tx.from);
  const balance = await nftBalance(address).catch(() => 0);
  await setSessionCookie({ address, method: "tx", balance });
  return NextResponse.json({ address, balance, method: "tx" });
}
