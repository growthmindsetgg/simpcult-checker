import "server-only";
import { randomUUID } from "node:crypto";
import {
  MONAD_CARD_ENABLED,
  POINTS_CONFIG,
  scaledReward,
  seasonAt,
  seasonBounds,
  utcDay,
  type PoolId,
} from "./config";
import { emit, normAddr } from "./ledger";
import { store } from "./store";
import { K } from "./keys";
import { HttpError } from "./http";
import { monadCardBalance, nftBalance, tokensOf } from "./chain";
import { fetchOEmbed, hasKeyword, parseStatusUrl, statusTime } from "./x";
import { getHandle } from "./xhandle";

/**
 * Submissions: X posts (holders), "simp" posts (Monad card holders) and
 * alpha / contributions (holders). Everything lands in one queue; X posts
 * from a verified handle can be auto-approved via oEmbed.
 *
 * Daily caps are per wallet AND per NFT: each Simp Cult tokenId carries
 * `dailyCap(kind)` submission slots per UTC day, whichever wallet holds it, so
 * one NFT hopping between wallets can't multiply the cap (same idea as the
 * check-in token lock). Monad card posts are capped per wallet only — card
 * holdings can't be enumerated per token.
 */

export type SubmissionKind = "x_post" | "simp_post" | "alpha";
export type SubmissionStatus = "pending" | "approved" | "rejected";

export type Submission = {
  id: string;
  kind: SubmissionKind;
  address: string;
  status: SubmissionStatus;
  createdAt: number;
  season: number;
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
  reward?: number;
  auto?: boolean;
  reviewedBy?: string;
  reviewedAt?: number;
  reviewNote?: string;
};

export const KIND_POOL: Record<SubmissionKind, PoolId> = {
  x_post: "active",
  simp_post: "monad",
  alpha: "active",
};

export function dailyCap(kind: SubmissionKind): number {
  const r = POINTS_CONFIG.rewards;
  return kind === "x_post" ? r.xPost.dailyCap : kind === "simp_post" ? r.simpPost.dailyCap : r.alpha.dailyCap;
}

export function defaultReward(kind: SubmissionKind, season = seasonAt()): number {
  const r = POINTS_CONFIG.rewards;
  const base = kind === "x_post" ? r.xPost.reward : kind === "simp_post" ? r.simpPost.reward : r.alpha.default;
  return scaledReward(base, season);
}

/** admin-adjustable bounds for a reward on approval */
export function rewardBounds(kind: SubmissionKind, season = seasonAt()): { min: number; max: number } {
  if (kind === "alpha") {
    const a = POINTS_CONFIG.rewards.alpha;
    return { min: scaledReward(a.min, season), max: scaledReward(a.max, season) };
  }
  const d = defaultReward(kind, season);
  return { min: 1, max: d * 2 };
}

const CAP_TTL_SEC = 60 * 60 * 50; // keep ~2 days

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
 * Reserve today's submission slot: the wallet's own cap first, then (for
 * holder kinds) a slot on one of its NFTs. The token slot is taken last and
 * the wallet counter is handed back if it fails, so a refusal costs nothing.
 * `tokens` is null for kinds that aren't backed by Simp Cult NFTs.
 */
async function bumpCap(kind: SubmissionKind, a: string, tokens: number[] | null) {
  const day = utcDay();
  const key = K.cap(kind, a, day);
  const n = await store().incrby(key, 1, CAP_TTL_SEC);
  if (n > dailyCap(kind)) {
    await store().incrby(key, -1);
    throw new HttpError(429, `daily limit reached (${dailyCap(kind)}/day) — come back tomorrow`, "cap");
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
  const day = utcDay();
  const kinds: SubmissionKind[] = ["x_post", "simp_post", "alpha"];
  const used = await Promise.all(kinds.map((k) => store().num(K.cap(k, a, day))));
  return Object.fromEntries(kinds.map((k, i) => [k, Math.max(0, dailyCap(k) - used[i])])) as Record<
    SubmissionKind,
    number
  >;
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
  if (kind !== "x_post" && kind !== "simp_post" && kind !== "alpha") throw new HttpError(400, "unknown submission type");

  // ── eligibility (always live reads) ──
  /** Simp Cult tokenIds backing this submission; null for Monad card posts */
  let tokens: number[] | null = null;
  if (kind === "simp_post") {
    if (!MONAD_CARD_ENABLED) throw new HttpError(409, "monad card posts open soon", "monad_card_off");
    if ((await monadCardBalance(a).catch(() => 0)) < 1) {
      throw new HttpError(403, "simp posts are for monad card holders", "not_card_holder");
    }
  } else {
    if ((await nftBalance(a as `0x${string}`).catch(() => 0)) < 1) {
      throw new HttpError(403, "this one's for simp cult holders", "not_holder");
    }
    tokens = await tokensOf(a);
    if (tokens.length === 0) {
      // the owner snapshot is up to a minute behind a fresh purchase
      throw new HttpError(403, "this one's for simp cult holders — just got yours? try again in a minute", "not_holder");
    }
  }

  const base: Submission = {
    id: randomUUID(),
    kind,
    address: a,
    status: "pending",
    createdAt: Date.now(),
    season,
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
    const keywords = kind === "x_post" ? POINTS_CONFIG.x.simpCultKeywords : POINTS_CONFIG.x.simpKeywords;
    s.check = o
      ? { reachable: true, author: o.authorHandle, keyword: hasKeyword(o.text, keywords) }
      : { reachable: false };
    const authorOk = !!o && o.authorHandle.toLowerCase() === h.handle.toLowerCase();
    if (verified && authorOk && s.check.keyword) {
      await persistNew(s);
      // if instant credit fails (e.g. pool tapped out) it just stays pending
      return approve(s.id, { by: "auto", auto: true }).catch(() => s);
    }
  }

  await persistNew(s);
  return s;
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
    const amount = opts.amount ?? defaultReward(s.kind, season);
    const { min, max } = rewardBounds(s.kind, season);
    if (!Number.isSafeInteger(amount) || amount < min || amount > max) {
      throw new HttpError(400, `reward must be a whole number between ${min} and ${max}`);
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
    // idempotent on the submission id — a retry can never double-pay
    await emit(KIND_POOL[s.kind], s.address, amount, s.kind, `sub:${s.id}`, { submission: s.id });
    const done: Submission = {
      ...s,
      status: "approved",
      reward: amount,
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
