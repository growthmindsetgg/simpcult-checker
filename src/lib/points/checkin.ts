import "server-only";
import { checkinReward, previousUtcDay, seasonAt, utcDay } from "./config";
import { emit, normAddr, type Receipt } from "./ledger";
import { store } from "./store";
import { K } from "./keys";
import { tokensOf } from "./chain";
import { HttpError } from "./http";

/**
 * Daily check-in: once per UTC day per wallet, holders only. Each tokenId can
 * only power one check-in per day, so one NFT hopping between wallets can't
 * farm the reward.
 */

type Streak = { last: string; count: number };

const refFor = (day: string) => `checkin:${day}`;

export async function checkinStatus(addr: string) {
  const a = normAddr(addr);
  const day = utcDay();
  const [done, streak] = await Promise.all([
    store().get<unknown>(K.ref("e", a, refFor(day))),
    store().get<Streak>(K.streak(a)),
  ]);
  const alive = !!streak && (streak.last === day || streak.last === previousUtcDay(day));
  const current = alive ? streak!.count : 0;
  return {
    checkedInToday: !!done,
    streak: current,
    /** today's reward if not checked in yet, otherwise tomorrow's */
    nextReward: checkinReward(seasonAt(), current + 1),
  };
}

export async function checkin(addr: string): Promise<Receipt & { streak: number }> {
  const a = normAddr(addr);
  const day = utcDay();
  const season = seasonAt();
  if (season < 1) throw new HttpError(409, "season 1 hasn't started yet", "season_closed");

  if (await store().get<unknown>(K.ref("e", a, refFor(day)))) {
    throw new HttpError(409, "already checked in today — back after midnight UTC", "already");
  }

  const tokens = await tokensOf(a);
  if (tokens.length === 0) throw new HttpError(403, "check-ins are for simp cult holders", "not_holder");

  const fresh = await store().saddEach(
    K.checkinTokens(day),
    tokens.map(String),
    60 * 60 * 50, // keep ~2 days
  );
  if (!fresh.some(Boolean)) {
    throw new HttpError(409, "your simps already checked in today from another wallet", "tokens_used");
  }

  const prev = await store().get<Streak>(K.streak(a));
  const streak = prev && prev.last === previousUtcDay(day) ? prev.count + 1 : 1;
  const amount = checkinReward(season, streak);

  const receipt = await emit("active", a, amount, "checkin", refFor(day), { streak, day });
  if (!receipt.duplicate) await store().set(K.streak(a), { last: day, count: streak });
  return { ...receipt, streak };
}
