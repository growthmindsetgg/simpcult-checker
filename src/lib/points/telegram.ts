import "server-only";
import { telegramLink } from "@/lib/server/telegram";

/**
 * Read-only Telegram link status for the 3x activity bonus. The link store
 * belongs to src/lib/server/telegram.ts (not ours to edit): any link it
 * returns counts as bound, "declared" (self-confirmed @handle) or "bot"
 * alike. Never `linkedUsers()`: that SCANs every key.
 * A failed read counts as "not bound" so a payout never fails over it.
 */
export async function telegramBound(address: string): Promise<boolean> {
  try {
    return (await telegramLink(address.toLowerCase())) !== null;
  } catch {
    return false;
  }
}
