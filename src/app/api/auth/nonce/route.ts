import { getAddress, isAddress, stringToHex } from "viem";
import { issueNonce } from "@/lib/server/nonce";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { crossSite, fail, guard, json, tooMany } from "@/lib/server/http";
import { CHAIN_ID } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET  → SIWE nonce, single use, 5 minute TTL. Consumed by /verify.
 * POST { address } → "send and set" nonce, single use, 15 minute TTL, plus the
 *   exact transaction to send: 0 MON from `address` to itself on Monad (143)
 *   with calldata = hex("simpcult:<nonce>"). Consumed by /verify-tx, which only
 *   accepts a transaction sent from that address.
 *
 * Either way the nonce is spendable only by the browser that asked for it
 * (see src/lib/server/nonce.ts), and asking again replaces the previous one.
 */
export const GET = guard(async (req: Request) => {
  // a link or redirect from another site must not be able to replace this
  // browser's nonce cookie (that would orphan a code someone already sent)
  const site = req.headers.get("sec-fetch-site");
  if ((site && site !== "same-origin" && site !== "none") || req.headers.get("sec-fetch-mode") === "navigate" || crossSite(req)) {
    return fail(403, "cross-site request refused");
  }
  if (!(await rateLimit("nonce", clientIp(req), 30, 60))) return tooMany();
  const { nonce, expiresAt } = await issueNonce();
  return json({ nonce, expiresAt });
});

export const POST = guard(async (req: Request) => {
  const site = req.headers.get("sec-fetch-site");
  if (crossSite(req) || (site && site !== "same-origin" && site !== "none")) return fail(403, "cross-site request refused");
  if (!(await rateLimit("nonce", clientIp(req), 30, 60))) return tooMany();
  const body = (await req.json().catch(() => null)) as { address?: unknown } | null;
  const raw = typeof body?.address === "string" ? body.address.trim() : "";
  if (!isAddress(raw, { strict: false })) return fail(400, "that doesn’t look like a wallet address (0x + 40 hex characters)");
  const address = getAddress(raw);
  const { nonce, expiresAt } = await issueNonce(address);
  return json({
    nonce,
    expiresAt,
    tx: { chainId: CHAIN_ID, from: address, to: address, value: "0", data: stringToHex(`simpcult:${nonce}`) },
  });
});
