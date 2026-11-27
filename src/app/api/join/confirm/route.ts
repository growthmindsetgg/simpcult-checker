import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Retired. This route ran a parallel "send a random amount to yourself" login
 * whose challenge wasn't bound to the browser that asked for it: anyone who saw
 * the self-transaction on chain could confirm it first and take the session.
 * Self-transaction sign-in now goes through POST /api/auth/nonce { address }
 * and POST /api/auth/verify-tx, which bind the nonce to an httpOnly cookie.
 */
export function POST() {
  return fail(410, "this sign-in step moved. reload the join page and try again.");
}
