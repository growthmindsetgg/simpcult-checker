import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { randomInt } from "node:crypto";
import { kv } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/**
 * Issue a self-tx challenge for a wallet.
 *
 * Body: { address: "0x…" }
 * Response: { amountWei, amountMon, expiresAt }
 *
 * The amount is a unique random value in [0.001, 0.003] MON with 6 random
 * decimal digits (e.g. 0.001734 MON). It is stored in KV under the lowercase
 * address for 15 minutes. The user then sends that exact amount from their
 * wallet to itself; /api/join/confirm verifies the on-chain tx matches.
 */
const TTL_SEC = 15 * 60;
const MIN_1E6 = 1_000; // 0.001 MON expressed in micro-MON (1e-6)
const MAX_1E6 = 3_000; // 0.003 MON expressed in micro-MON

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { address?: string } | null;
  if (!body?.address || !isAddress(body.address, { strict: false })) {
    return NextResponse.json({ error: "connect a wallet first" }, { status: 401 });
  }
  const address = getAddress(body.address).toLowerCase();

  // pick a random micro-MON value in [1000, 3000] inclusive
  const micro = randomInt(MIN_1E6, MAX_1E6 + 1); // 1000..3000
  // amountWei = micro × 1e12
  const amountWei = (BigInt(micro) * 10n ** 12n).toString();
  const amountMon = (micro / 1_000_000).toFixed(6);

  const expiresAt = Date.now() + TTL_SEC * 1000;
  await kv().set(`join:tx:${address}`, { amountWei, amountMon, expiresAt }, TTL_SEC);

  return NextResponse.json(
    { amountWei, amountMon, expiresAt },
    { headers: { "cache-control": "no-store" } },
  );
}
