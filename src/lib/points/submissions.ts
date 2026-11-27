import "server-only";
import { randomUUID } from "node:crypto";
import {
  MONAD_CARD_ENABLED,
  POINTS_CONFIG,
  finalWindow,
  scaledReward,
  seasonAt,
  seasonBounds,
  utcDay,
  type BucketId,
} from "./config";
import { normAddr } from "./ledger";
import { store } from "./store";
import { K } from "./keys";
import { HttpError } from "./http";
import { nftBalance } from "./chain";
import { fetchOEmbed, hasKeyword, parseStatusUrl, statusTime } from "./x";
import { getHandle } from "./xhandle";
import { communityBucket, notEligible, walletProfile } from "./eligibility";
import { payActivity } from "./activity";

/**
 * Submissions. Everything lands in one queue; X posts from a verified handle
 * can be auto-approved via oEmbed.
 *   x_post      — holders, about Simp Cult → active pool
 *   simp_post   — card holders (→ community 9%) and active Monad users
 *                 (→ community 1%): any post with the word "simp"
 *   alpha       — holders (→ active) and card holders (→ community 9%)
 *   season_post — the final-48h "upcoming season" post, every category.
 *                 Pays nothing itself; it unlocks the season-end 90% share.
 * The bucket is fixed at submit time and stored on the submission. Approved
 * payouts go through `payActivity` (Telegram 3x).
 *
 * Daily caps are per wallet AND, for holder kinds, per NFT: each Simp Cult
 * tokenId carries `dailyCap(kind)` submission slots per UTC day, whichever
 * wallet holds it, so one NFT hopping between wallets can't multiply the cap
 * (same idea as the check-in token lock). Community posts are capped per
 * wallet only. The season post allows `dailyCap` tries per season.
 */

export type SubmissionKind = "x_post" | "simp_post" | "alpha" | "season_post";
export const SUBMISSION_KINDS: SubmissionKind[] = ["x_post", "simp_post", "alpha", "season_post"];
export type SubmissionStatus = "pending" | "approved" | "rejected";

export type Submission = {
  id: string;
  kind: SubmissionKind;
  address: string;
  status: SubmissionStatus;
  createdAt: number;
  season: number;
  /** where an approval pays from (absent on submissions before rules v2) */
  bucket?: BucketId;
  // x posts
  url?: string;
  tweetId?: string;
  handle?: string;
  /** false = the handle was never proven, so the post may not be theirs */
  handleVerified?: boolean;
  postedAt?: number;
  /** what oEmbed told us, if it answered */
  check?: { author?: string; keyword?: boolean; reachable: boolean };
  // alpha
  title?: string;
  note?: string;
  proof?: string[];
  // review
  /** points actually paid (after any Telegram multiplier) */
  reward?: number;
  auto?: boolean;
  reviewedBy?: string;
  reviewedAt?: number;
  reviewNote?: string;
};

/** bucket for submissions made before rules v2 stored one */
const LEGACY_BUCKET: Record<SubmissionKind, BucketId> = {
  x_post: "active",
  simp_post: "card",
  alpha: "active",
  season_post: "active",
};

const SEASON_POST_TRIES = 3;

export function dailyCap(kind: SubmissionKind): number {
  const r = POINTS_CONFIG.rewards;
  if (kind === "season_post") return SEASON_POST_TRIES;
  return kind === "x_post" ? r.xPost.dailyCap : kind === "simp_post" ? r.simpPost.dailyCap : r.alpha.dailyCap;
}

/** the base reward (before any Telegram multiplier); 0 for the season post */
export function defaultReward(kind: SubmissionKind, season = seasonAt()): number {
  const r = POINTS_CONFIG.rewards;
  if (kind === "season_post") return 0;
  const base = kind === "x_post" ? r.xPost.reward : kind === "simp_post" ? r.simpPost.reward : r.alpha.default;
  return scaledReward(base, season);
}

/** admin-adjustable bounds for a base reward on approval */
export function rewardBounds(kind: SubmissionKind, season = seasonAt()): { min: number; max: number } {
  if (kind === "season_post") return { min: 0, max: 0 };
  if (kind === "alpha") {
    const a = POINTS_CONFIG.rewards.alpha;
    return { min: scaledReward(a.min, season), max: scaledReward(a.max, season) };
  }
  const d = defaultReward(kind, season);
  return { min: 1, max: d * 2 };
}

const CAP_TTL_SEC = 60 * 60 * 50; // keep ~2 days
const SEASON_CAP_TTL_SEC = 60 * 60 * 24 * 60;

/** cap window: the UTC day, or the whole season for the season post */
const capWindow = (kind: SubmissionKind) => (kind === "season_post" ? `s${seasonAt()}` : utcDay());

/**
 * Take one of today's slots on one of `tokens`. Each SADD is atomic, so a
 * slot can only ever be taken once, whoever holds the token.
 */
async function takeTokenSlot(kind: SubmissionKind, tokens: number[], day: string): Promise<boolean> {
  const key = K.subTokens(kind, day);
  const slots = dailyCap(kind);
  for (const token of tokens) {
    for (let slot = 0; slot < slots; slot++) {
      const [fresh] = await store().saddEach(key, [`${token}:${slot}`], CAP_TTL_SEC);
      if (fresh) return true;
    }
  }
  return false;
}

/**
 * Reserve a submission slot: the wallet's own cap first, then (for holder
 * kinds) a slot on one of its NFTs. The token slot is taken last and the
 * wallet counter is handed back if it fails, so a refusal costs nothing.
 * `tokens` is null for kinds that aren't backed by Simp Cult NFTs.
 */
async function bumpCap(kind: SubmissionKind, a: string, tokens: number[] | null) {
  const day = utcDay();
  const key = K.cap(kind, a, capWindow(kind));
  const n = await store().incrby(key, 1, kind === "season_post" ? SEASON_CAP_TTL_SEC : CAP_TTL_SEC);
  if (n > dailyCap(kind)) {
    await store().incrby(key, -1);
    throw new HttpError(
      429,
      kind === "season_post"
        ? `that's ${dailyCap(kind)} tries for the season post — a human will check the ones in review`
        : `daily limit reached (${dailyCap(kind)}/day) — come back tomorrow`,
      "cap",
    );
  }
  if (!tokens) return;
  let took = false;
  try {
    took = await takeTokenSlot(kind, tokens, day);
  } finally {
    if (!took) await store().incrby(key, -1);
  }
  if (!took) {
    throw new HttpError(
      429,
      "your simps already used today's submissions from another wallet — come back tomorrow",
      "tokens_used",
    );
  }
}

export async function capsLeft(addr: string): Promise<Record<SubmissionKind, number>> {
  const a = normAddr(addr);
  const used = await Promise.all(SUBMISSION_KINDS.map((k) => store().num(K.cap(k, a, capWindow(k)))));
  return Object.fromEntries(SUBMISSION_KINDS.map((k, i) => [k, Math.max(0, dailyCap(k) - used[i])])) as Record<
    SubmissionKind,
    number
  >;
}

export type SeasonPostStatus = {
  season: number;
  windowStart: number;
  windowEnd: number;
  open: boolean;
  state: "none" | "pending" | "approved";
};

/** final-48h post status for `season` (default: current) */
export async function seasonPostStatus(addr: string, season = seasonAt()): Promise<SeasonPostStatus> {
  const a = normAddr(addr);
  const s = Math.max(1, season);
  const w = finalWindow(s);
  const now = Date.now();
  const approvedId = await store().get<string>(K.seasonPost(s, a));
  let state: SeasonPostStatus["state"] = approvedId ? "approved" : "none";
  if (!approvedId) {
    const mine = await mySubmissions(a, 30);
    if (mine.some((x) => x.kind === "season_post" && x.season === s && x.status === "pending")) state = "pending";
  }
  return { season: s, windowStart: w.start, windowEnd: w.end, open: now >= w.start && now < w.end, state };
}

async function save(s: Submission) {
  await store().set(K.sub(s.id), s);
}

export async function getSubmission(id: string): Promise<Submission | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return store().get<Submission>(K.sub(id));
}

async function load(ids: string[]): Promise<Submission[]> {
  const rows = await Promise.all(ids.map((id) => store().get<Submission>(K.sub(id))));
  return rows.filter((r): r is Submission => !!r);
}

export type SubmitInput = {
  kind: SubmissionKind;
  url?: string;
  title?: string;
  note?: string;
  proof?: string[];
};

const HTTPS_RE = /^https:\/\/[^\s<>"]{3,500}$/i;

export async function submit(addr: string, input: SubmitInput): Promise<Submission> {
  const a = normAddr(addr);
  const season = seasonAt();
  if (season < 1) throw new HttpError(409, "season 1 hasn't started yet", "season_closed");
  const kind = input.kind;
  if (!SUBMISSION_KINDS.includes(kind)) throw new HttpError(400, "unknown submission type");

  // ── eligibility (live-ish reads: owner map ≤60s, tx count ≤10 min) ──
  const profile = await walletProfile(a);
  if (profile.category === "none") {
    // the owner snapshot is up to a minute behind a fresh purchase
    if (
      !profile.missedSnapshot &&
      (kind === "x_post" || kind === "alpha") &&
      (await nftBalance(a as `0x${string}`).catch(() => 0)) > 0
    ) {
      throw new HttpError(403, "just got your simp? give it a minute and try again", "not_holder");
    }
    throw notEligible(profile);
  }
  const holder = profile.category === "holder";
  /** Simp Cult tokenIds backing this submission; null for community kinds */
  let tokens: number[] | null = null;
  let bucket: BucketId;
  if (kind === "x_post") {
    if (!holder) {
      throw new HttpError(
        403,
        profile.missedSnapshot
          ? "this wallet missed a holding snapshot, so it earns as community this season: use simp posts"
          : "x posts about the cult are for holders — community wallets earn with simp posts",
        "not_holder",
      );
    }
    tokens = profile.tokens;
    bucket = "active";
  } else if (kind === "alpha") {
    if (holder) {
      tokens = profile.tokens;
      bucket = "active";
    } else if (profile.card) {
      bucket = "card";
    } else {
      throw new HttpError(403, "alpha slips are for holders and monad card holders", "not_holder");
    }
  } else if (kind === "simp_post") {
    const b = communityBucket(profile);
    if (!b) {
      throw new HttpError(
        403,
        MONAD_CARD_ENABLED
          ? "simp posts are for monad card holders and active monad users — holders use x posts"
          : "simp posts are for active monad users — holders use x posts",
        "not_community",
      );
    }
    bucket = b;
  } else {
    const w = finalWindow(season);
    const now = Date.now();
    if (now < w.start || now >= w.end) {
      throw new HttpError(409, "the season post opens in the last 48 hours of the season", "window_closed");
    }
    if (await store().get<string>(K.seasonPost(season, a))) {
      throw new HttpError(409, "your season post is already in. you're set for the season-end share.", "already");
    }
    bucket = holder ? "active" : (communityBucket(profile) ?? "active");
  }

  const base: Submission = {
    id: randomUUID(),
    kind,
    address: a,
    status: "pending",
    createdAt: Date.now(),
    season,
    bucket,
  };

  if (kind === "alpha") {
    const title = (input.title ?? "").trim();
    const note = (input.note ?? "").trim();
    const proof = (input.proof ?? []).map((p) => String(p).trim()).filter(Boolean);
    if (title.length < 4 || title.length > 120) throw new HttpError(400, "give it a title (4–120 chars)");
    if (note.length > 2000) throw new HttpError(400, "keep the details under 2000 chars");
    if (proof.length < 1 || proof.length > 3) throw new HttpError(400, "add 1–3 proof links");
    if (!proof.every((p) => HTTPS_RE.test(p))) throw new HttpError(400, "proof links must be https:// urls");
    await bumpCap(kind, a, tokens);
    const s: Submission = { ...base, title, note, proof };
    await persistNew(s);
    return s;
  }

  // ── X posts ──
  const h = await getHandle(a);
  if (!h) throw new HttpError(400, "add your X handle first", "no_handle");
  const parsed = parseStatusUrl(input.url ?? "");
  if (!parsed) throw new HttpError(400, "paste a post link like x.com/you/status/123…", "bad_url");
  if (parsed.handle.toLowerCase() !== h.handle.toLowerCase()) {
    throw new HttpError(400, `that link isn't from @${h.handle}`, "wrong_handle");
  }
  // a handle someone else has proven is theirs can't be used by anyone else
  const owner = await store().get<string>(K.xOwner(h.handle));
  if (owner && owner !== a) {
    throw new HttpError(409, `@${h.handle} is verified by another wallet`, "handle_taken");
  }
  const verified = h.verified && owner === a;
  const postedAt = statusTime(parsed.id);
  const maxAge = (kind === "x_post" ? POINTS_CONFIG.rewards.xPost : POINTS_CONFIG.rewards.simpPost).maxAgeDays;
  if (postedAt < seasonBounds(season).start) throw new HttpError(400, "that post is from before this season", "too_old");
  if (kind === "season_post" && postedAt < finalWindow(season).start) {
    throw new HttpError(400, "post it inside the last 48 hours of the season, then drop that link", "too_old");
  }
  if (Date.now() - postedAt > maxAge * 86_400_000) throw new HttpError(400, `posts older than ${maxAge} days don't count`, "too_old");
  if (postedAt > Date.now() + 60_000) throw new HttpError(400, "that post id looks off", "bad_url");

  // Global dedupe on the status id. Only a verified handle may claim it at
  // submit time (first verified submitter wins, forever) — an unproven handle
  // could be anyone, so it must not be able to lock the real author out. Its
  // submission claims the id when an admin approves it (see `approve`).
  if (verified) {
    const claimed = await store().set(K.tweet(parsed.id), base.id, { nx: true });
    if (!claimed) throw new HttpError(409, "that post was already submitted", "dupe");
  } else if (await store().get<string>(K.tweet(parsed.id))) {
    throw new HttpError(409, "that post was already submitted", "dupe");
  }

  try {
    await bumpCap(kind, a, tokens);
  } catch (e) {
    if (verified) await store().del(K.tweet(parsed.id));
    throw e;
  }

  const s: Submission = {
    ...base,
    url: parsed.canonical,
    tweetId: parsed.id,
    handle: h.handle,
    handleVerified: verified,
    postedAt,
  };

  // ── free auto-verify (verified handles only) ──
  if (POINTS_CONFIG.x.autoVerify) {
    const o = await fetchOEmbed(parsed.canonical);
    s.check = o ? { reachable: true, author: o.authorHandle, keyword: postMatches(kind, o.text) } : { reachable: false };
    const authorOk = !!o && o.authorHandle.toLowerCase() === h.handle.toLowerCase();
    if (verified && authorOk && s.check.keyword) {
      await persistNew(s);
      // if instant credit fails (e.g. instant budget used up) it just stays pending
      return approve(s.id, { by: "auto", auto: true }).catch(() => s);
    }
  }

  await persistNew(s);
  return s;
}

/** the keyword check for each X post kind */
function postMatches(kind: SubmissionKind, text: string): boolean {
  const x = POINTS_CONFIG.x;
  if (kind === "x_post") return hasKeyword(text, x.simpCultKeywords);
  if (kind === "simp_post") return hasKeyword(text, x.simpKeywords);
  // season post: about simp / the cult AND about the season
  return hasKeyword(text, [...x.simpCultKeywords, ...x.simpKeywords]) && hasKeyword(text, x.seasonKeywords);
}

async function persistNew(s: Submission) {
  await save(s);
  await store().zadd(K.subsPending(), s.createdAt, s.id);
  await store().zadd(K.subsUser(s.address), s.createdAt, s.id);
}

export async function mySubmissions(addr: string, limit = 30): Promise<Submission[]> {
  const ids = (await store().zrevrange(K.subsUser(normAddr(addr)), 0, limit - 1)).map((r) => r.member);
  return load(ids);
}

export async function pendingQueue(limit = 100): Promise<Submission[]> {
  return load(await store().zrange(K.subsPending(), 0, limit - 1));
}

/** pending final-48h posts for a season (they block its freeze) */
export async function pendingSeasonPosts(season: number): Promise<number> {
  return (await pendingQueue(1000)).filter((s) => s.kind === "season_post" && s.season === season).length;
}

export async function recentlyReviewed(limit = 50): Promise<Submission[]> {
  return load((await store().zrevrange(K.subsDone(), 0, limit - 1)).map((r) => r.member));
}

async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const key = `${K.sub(id)}:lock`;
  if (!(await store().set(key, "1", { nx: true, ex: 30 }))) {
    throw new HttpError(409, "someone else is reviewing this one right now", "locked");
  }
  try {
    return await fn();
  } finally {
    await store().del(key);
  }
}

export async function approve(
  id: string,
  opts: { by: string; amount?: number; note?: string; auto?: boolean },
): Promise<Submission> {
  return withLock(id, async () => {
    const s = await getSubmission(id);
    if (!s) throw new HttpError(404, "submission not found");
    if (s.status !== "pending") throw new HttpError(409, `already ${s.status}`);
    const season = seasonAt();
    const isSeasonPost = s.kind === "season_post";
    const amount = isSeasonPost ? 0 : (opts.amount ?? defaultReward(s.kind, season));
    const { min, max } = rewardBounds(s.kind, season);
    if (!isSeasonPost && (!Number.isSafeInteger(amount) || amount < min || amount > max)) {
      throw new HttpError(400, `reward must be a whole number between ${min} and ${max}`);
    }
    // a frozen season's share basis can't change under it
    if (isSeasonPost && (await store().get<unknown>(K.settle(s.season)))) {
      throw new HttpError(409, `season ${s.season} is already frozen — this post came too late to count`, "season_frozen");
    }
    if (s.tweetId) {
      // the handle may have been proven by someone else since this was submitted
      const owner = s.handle ? await store().get<string>(K.xOwner(s.handle)) : null;
      if (owner && owner !== s.address) {
        throw new HttpError(409, `@${s.handle} is now verified by another wallet — reject this one`, "handle_taken");
      }
      // one post, one payout: claim the status id (a verified submission
      // already holds it; an unverified one claims it here)
      const claimed = await store().set(K.tweet(s.tweetId), s.id, { nx: true });
      if (!claimed && (await store().get<string>(K.tweet(s.tweetId))) !== s.id) {
        throw new HttpError(409, "that post was already credited to another submission", "dupe");
      }
    }
    let paid = 0;
    if (isSeasonPost) {
      // counts for the season it was submitted in, whenever it's approved
      await store().set(K.seasonPost(s.season, s.address), s.id);
      await store().saddEach(K.seasonPosters(s.season), [s.address]);
    } else {
      // idempotent on the submission id — a retry can never double-pay
      const r = await payActivity(s.bucket ?? LEGACY_BUCKET[s.kind], s.address, amount, s.kind, `sub:${s.id}`, {
        submission: s.id,
      });
      paid = r.entry.amount;
    }
    const done: Submission = {
      ...s,
      status: "approved",
      reward: paid,
      auto: !!opts.auto,
      reviewedBy: opts.by,
      reviewedAt: Date.now(),
      ...(opts.note ? { reviewNote: opts.note.slice(0, 500) } : {}),
    };
    await finish(done);
    return done;
  });
}

export async function reject(id: string, opts: { by: string; note?: string }): Promise<Submission> {
  return withLock(id, async () => {
    const s = await getSubmission(id);
    if (!s) throw new HttpError(404, "submission not found");
    if (s.status !== "pending") throw new HttpError(409, `already ${s.status}`);
    const done: Submission = {
      ...s,
      status: "rejected",
      reviewedBy: opts.by,
      reviewedAt: Date.now(),
      ...(opts.note ? { reviewNote: opts.note.slice(0, 500) } : {}),
    };
    await finish(done);
    // a post submitted from an unproven handle may not be the submitter's —
    // if this submission holds its id (a failed approval, or one made before
    // unverified submissions stopped claiming ids), free it for the real author
    if (s.tweetId && !s.handleVerified && (await store().get<string>(K.tweet(s.tweetId))) === s.id) {
      await store().del(K.tweet(s.tweetId));
    }
    return done;
  });
}

async function finish(s: Submission) {
  await save(s);
  await store().zrem(K.subsPending(), s.id);
  await store().zadd(K.subsDone(), s.reviewedAt ?? Date.now(), s.id);
}
