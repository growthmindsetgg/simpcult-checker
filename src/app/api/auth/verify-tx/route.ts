import { getAddress, isAddress, stringToHex, type Hex, type Transaction, type TransactionReceipt } from "viem";
import { consumeNonce, peekNonce, NONCE_RE } from "@/lib/server/nonce";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { publicClient, nftBalance } from "@/lib/server/chain";
import { setSessionCookie } from "@/lib/server/session";
import { crossSite, fail, guard, json, tooMany } from "@/lib/server/http";
import { CHAIN_ID, short } from "@/lib/config";

export const dynamic = "force-dynamic";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Proof of ownership by self-transaction, for people who don't connect a
 * wallet here ("send and set") or whose wallet can't sign messages:
 * 0 MON FROM the address TO the same address on Monad, calldata =
 * hex("simpcult:<nonce>"). We check the mined transaction.
 *
 * Body: { hash, nonce, address? }. A nonce issued by POST /api/auth/nonce is
 * bound to an address and only verifies a transaction from it; `address` in
 * the body is an extra check for nonces issued without one.
 *
 * The nonce is public once the transaction is broadcast, so it is not a
 * secret: what ties it to the caller is the httpOnly nonce cookie set when it
 * was issued. Order of checks:
 *   1. cookie matches the nonce (read only, so the chain is never queried
 *      for a stranger),
 *   2. the transaction is mined and matches the template (a hash pasted a
 *      few seconds early just gets "not found yet"; the nonce stays usable),
 *   3. the nonce is spent with an atomic get-and-delete. Only the request that
 *      wins it gets a session, so a `{hash, nonce}` pair still yields at most
 *      one session, and only in the browser that asked.
 */
export const POST = guard(async (req: Request) => {
  if (crossSite(req)) return fail(403, "cross-site request refused");
  if (!(await rateLimit("verify-tx", clientIp(req), 10, 60))) return tooMany();

  const body = (await req.json().catch(() => null)) as { hash?: unknown; nonce?: unknown; address?: unknown } | null;
  const hash = typeof body?.hash === "string" ? body.hash.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce : "";
  const claimed = typeof body?.address === "string" && body.address ? body.address.trim() : null;
  if (!HASH_RE.test(hash)) return fail(400, "paste the full transaction hash: 0x followed by 64 hex characters");
  if (!NONCE_RE.test(nonce)) return fail(400, "bad request");
  if (claimed !== null && !isAddress(claimed, { strict: false })) return fail(400, "that doesn’t look like a wallet address");

  const rec = await peekNonce(nonce);
  if (!rec) return fail(401, "this code expired or belongs to another browser. get a new code and send a new transaction.");
  const expected = rec.a ?? (claimed ? getAddress(claimed) : null);

  // give a just-sent transaction a moment to land; the nonce is still unspent
  const receipt: TransactionReceipt | null = await publicClient
    .waitForTransactionReceipt({ hash: hash as Hex, timeout: 8_000, pollingInterval: 1_000 })
    .catch(() => null);
  if (!receipt) return fail(409, "that transaction isn’t on monad yet. wait a few seconds and press verify again.");
  if (receipt.status !== "success") return fail(400, "that transaction failed on chain. send a new one with the same details.");

  const tx: Transaction | null = await publicClient.getTransaction({ hash: hash as Hex }).catch(() => null);
  if (!tx) return fail(409, "couldn’t read that transaction yet. press verify again in a few seconds.");

  if (tx.chainId !== undefined && tx.chainId !== CHAIN_ID) return fail(400, `that transaction isn’t on monad (chain ${CHAIN_ID})`);
  const from = getAddress(tx.from);
  if (!tx.to || getAddress(tx.to) !== from) return fail(400, "that transaction isn’t sent to its own address. the “to” must equal the “from”.");
  if (tx.value !== 0n) return fail(400, "that transaction sends MON. it must send 0.");
  if (tx.input.toLowerCase() !== stringToHex(`simpcult:${nonce}`).toLowerCase()) {
    return fail(400, "that transaction’s data doesn’t match your code. copy the data field exactly.");
  }
  if (expected && from !== expected) {
    return fail(400, `that transaction was sent from ${short(from)}, not ${short(expected)}`);
  }

  // belt and braces: the nonce TTL already bounds this
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  if (Number(block.timestamp) * 1000 < Date.now() - MAX_AGE_MS) return fail(400, "that transaction is too old. send a new one.");

  if (!(await consumeNonce(nonce))) return fail(401, "this code was just used. get a new code to verify again.");

  const balance = await nftBalance(from).catch(() => 0);
  await setSessionCookie({ address: from, method: "tx", balance });
  return json({ address: from, balance, method: "tx" });
});
