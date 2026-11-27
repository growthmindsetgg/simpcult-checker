import { parseSiweMessage, verifySiweMessage } from "viem/siwe";
import { getAddress, isAddress, isHex } from "viem";
import { consumeNonce } from "@/lib/server/nonce";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { publicClient, nftBalance } from "@/lib/server/chain";
import { setSessionCookie } from "@/lib/server/session";
import { crossSite, fail, guard, json, tooMany } from "@/lib/server/http";
import { CHAIN_ID, SITE } from "@/lib/config";

export const dynamic = "force-dynamic";

const MAX_MESSAGE = 2_000;
const MAX_SIGNATURE = 20_000; // ERC-6492 wrapped signatures can be long

/**
 * Sign-In With Ethereum (EIP-4361) verification.
 * Checks: signature (EOA, ERC-1271 smart wallets, ERC-6492), domain binding,
 * chain id 143, nonce is ours + unused + unexpired + issued to this browser,
 * message not expired / not yet valid.
 */
export const POST = guard(async (req: Request) => {
  if (crossSite(req)) return fail(403, "cross-site request refused");
  if (!(await rateLimit("verify", clientIp(req), 10, 60))) return tooMany();
  const body = (await req.json().catch(() => null)) as { message?: unknown; signature?: unknown } | null;
  const message = body?.message;
  const signature = body?.signature;
  if (
    typeof message !== "string" ||
    message.length > MAX_MESSAGE ||
    typeof signature !== "string" ||
    signature.length > MAX_SIGNATURE ||
    !isHex(signature)
  ) {
    return fail(400, "bad request");
  }

  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    return fail(400, "that sign-in message is malformed");
  }
  if (!parsed.address || !isAddress(parsed.address, { strict: false }) || !parsed.nonce) {
    return fail(400, "that sign-in message is malformed");
  }
  if (parsed.chainId !== CHAIN_ID) return fail(400, `wrong network. sign in on monad (chain ${CHAIN_ID}).`);
  if (parsed.domain !== SITE.domain) return fail(400, `this message was made for ${parsed.domain}, not ${SITE.domain}`);

  // consume nonce (single use, bound to this browser's nonce cookie)
  if (!(await consumeNonce(parsed.nonce))) {
    return fail(401, "that sign-in code expired or was already used. try again.");
  }

  let ok = false;
  try {
    ok = await verifySiweMessage(publicClient, {
      message,
      signature,
      domain: SITE.domain,
      nonce: parsed.nonce,
    });
  } catch (e) {
    console.error("[auth/verify] verifySiweMessage", (e as Error).message);
    return fail(502, "couldn’t check the signature on monad right now. try again.");
  }
  if (!ok) return fail(401, "that signature doesn’t match this wallet");

  const address = getAddress(parsed.address);
  const balance = await nftBalance(address).catch(() => 0);
  await setSessionCookie({ address, method: "siwe", balance });
  return json({ address, balance, method: "siwe" });
});
