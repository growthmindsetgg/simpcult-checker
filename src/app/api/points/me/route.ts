import { getBalance } from "@/lib/points";
import { MONAD_CARD_ENABLED, POINTS_CONFIG, checkinReward, previousUtcDay, scaledReward, seasonAt, utcDay } from "@/lib/points/config";
import { closeDueDays, quote, todayPool } from "@/lib/points/pace";
import { store } from "@/lib/points/store";
import { K } from "@/lib/points/keys";
import type { LedgerEntry } from "@/lib/points/ledger";
import { checkinStatus } from "@/lib/points/checkin";
import { CATEGORY_LABEL, activityBucket, walletProfile } from "@/lib/points/eligibility";
import { holdingStatus } from "@/lib/points/holding";
import { maybeSnapshot, snapshotCount } from "@/lib/points/snapshots";
import { capsLeft, mySubmissions, seasonPostStatus } from "@/lib/points/submissions";
import { myRank, projection } from "@/lib/points/season";
import { telegramBound } from "@/lib/points/telegram";
import { welcomeStatus } from "@/lib/points/welcome";
import { getHandle } from "@/lib/points/xhandle";
import { background, handle, isAdminSession, ok, requireSession } from "@/lib/points/http";

export const dynamic = "force-dynamic";
// room for the after-response work (snapshot, closing yesterday's daily split)
export const maxDuration = 60;

/**
 * Everything the portal needs about the signed-in wallet, in one call. Also
 * grants the one-time welcome bonus when it's due (idempotent), and after
 * responding takes a random holding snapshot and closes yesterday's daily
 * split if either is due.
 */
export const GET = handle(async () => {
  const s = await requireSession();
  const a = s.address;
  background(() => maybeSnapshot());
  background(() => closeDueDays());
  const season = Math.max(1, seasonAt());
  // the tx count is cached (≥50 for good, otherwise 10 min); an RPC hiccup shows as null
  const profile = await walletProfile(a, { withTx: true }).catch(() => walletProfile(a));
  const welcome = await welcomeStatus(profile);
  const [balance, checkin, x, caps, submissions, rank, tg, seasonPost, holding, snaps, projected] = await Promise.all([
    getBalance(a),
    checkinStatus(a),
    getHandle(a),
    capsLeft(a),
    mySubmissions(a, 20),
    myRank(a),
    telegramBound(a),
    seasonPostStatus(a, season),
    holdingStatus(a, season),
    snapshotCount(season),
    projection(a, season),
  ]);
  // a holder that missed a snapshot earns as community for the rest of the season
  const holder = profile.category === "holder";
  const activeMonad = profile.category === "active_monad";

  // today's daily split for the wallet's sub-pool, and what its actions pay right now
  const bucket = seasonAt() >= 1 ? activityBucket(profile) : null;
  let today = null;
  if (bucket) {
    const mult = tg ? POINTS_CONFIG.telegramMultiplier : 1;
    const r = POINTS_CONFIG.rewards;
    const postBase = scaledReward(holder ? r.xPost.reward : r.simpPost.reward, season);
    const yday = previousUtcDay(utcDay());
    const [pool, ck, post, prev] = await Promise.all([
      todayPool(bucket, a),
      checkin.checkedInToday ? Promise.resolve(null) : quote(bucket, checkinReward(season, checkin.streak + 1) * mult, a),
      quote(bucket, postBase * mult, a),
      store().get<LedgerEntry>(K.ref("e", a.toLowerCase(), `dayshare:${yday}:${bucket}:${a.toLowerCase()}`)),
    ]);
    today = {
      ...pool,
      /** "max today": the most this wallet can get today (instant + day share) */
      maxToday: pool.walletCap,
      checkinNow: ck ? ck.instant : null,
      postNow: post.instant,
      yesterdayShare: prev ? prev.amount : null,
    };
  }
  return ok({
    address: a,
    balance,
    holder,
    nfts: profile.tokens.length,
    monadCard: { enabled: MONAD_CARD_ENABLED, holder: profile.card },
    category: profile.category,
    categoryLabel: CATEGORY_LABEL[profile.category],
    categories: { holder, card: profile.card, activeMonad },
    txCount: profile.txCount,
    telegram: { bound: tg, multiplier: tg ? POINTS_CONFIG.telegramMultiplier : 1, bonus: POINTS_CONFIG.telegramMultiplier },
    welcome,
    seasonPost,
    holding: {
      ...holding,
      txOk: profile.txCount === null ? null : profile.txCount >= POINTS_CONFIG.tx.holdingDrop,
      snapshots: snaps,
    },
    projected,
    today,
    checkin,
    x: x ? { handle: x.handle, verified: x.verified, code: x.verified ? undefined : x.code } : null,
    caps,
    submissions,
    rank,
    admin: isAdminSession(s),
  });
});
