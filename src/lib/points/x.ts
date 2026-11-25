import "server-only";
import { POINTS_CONFIG } from "./config";

/**
 * X (Twitter) helpers — no paid API.
 *
 *  - URL parsing: accepts x.com / twitter.com / mobile. / www. links to a
 *    status; normalises to the numeric status id (the global dedupe key).
 *  - Post time: decoded from the status id (snowflake), so we can reject old
 *    posts without calling X at all.
 *  - oEmbed: X's free public embed endpoint returns the author and post text
 *    for public posts. If it answers, we can verify author + keyword; if it
 *    doesn't (rate limit, deleted, protected, endpoint gone), the submission
 *    simply waits for admin review.
 */

export const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const STATUS_RE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})(?:[/?#].*)?$/i;

export function normHandle(h: string): string {
  return h.trim().replace(/^@/, "");
}

export function parseStatusUrl(url: string): { handle: string; id: string; canonical: string } | null {
  const m = STATUS_RE.exec(url.trim());
  if (!m) return null;
  const [, handle, id] = m;
  if (handle.toLowerCase() === "i") return null; // x.com/i/status/… has no author
  return { handle, id, canonical: `https://x.com/${handle}/status/${id}` };
}

/** creation time encoded in a post id (ms since epoch) */
export function statusTime(id: string): number {
  return Number((BigInt(id) >> BigInt(22)) + BigInt(1288834974657));
}

export type OEmbed = { authorHandle: string; text: string };

export async function fetchOEmbed(url: string, timeoutMs = 4000): Promise<OEmbed | null> {
  const q = new URL(POINTS_CONFIG.x.oembedUrl);
  q.searchParams.set("url", url);
  q.searchParams.set("omit_script", "1");
  q.searchParams.set("dnt", "true");
  try {
    const r = await fetch(q, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!r.ok) return null;
    const d = (await r.json()) as { author_url?: string; html?: string };
    const authorHandle = d.author_url?.split("/").filter(Boolean).pop() ?? "";
    const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(d.html ?? "");
    const text = decodeEntities((p?.[1] ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""));
    if (!authorHandle) return null;
    return { authorHandle, text };
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whole-word keyword match (case-insensitive). Plural / verb endings count
 * ("simps", "simping"), but "simple" or "simply" don't.
 */
export function hasKeyword(text: string, keywords: readonly string[]): boolean {
  return keywords.some((k) =>
    new RegExp(`(^|[^a-z0-9_])${esc(k.toLowerCase())}(s|es|ing|ed|er|ers|in)?(?=$|[^a-z0-9_])`, "i").test(text),
  );
}
