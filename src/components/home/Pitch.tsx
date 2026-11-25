import Link from "next/link";
import { MONAD_CARD_ENABLED, POINTS_CONFIG, POOLS, seasonBudget, type PoolId } from "@/lib/points/config";
import { LINKS } from "@/lib/config";
import { Reveal } from "@/components/motion";
import { MediaSlot } from "./MediaSlot";
import { LORE_SLOTS, NFT_SLOTS } from "./slots";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en");
const R = POINTS_CONFIG.rewards;

/* ── 1 · how it works (a real sequence, so it is numbered) ─────────── */
export function HowItWorks() {
  const seasons = Array.from({ length: 6 }, (_, i) => ({ n: i + 1, budget: seasonBudget(i + 1) }));
  const top = seasons[0].budget;

  return (
    <section id="how" className="section" aria-labelledby="how-title">
      <div className="shell">
        <Reveal className="section-head">
          <h2 id="how-title" className="t-h1">how the machine works</h2>
          <p className="t-lead">three steps. your mom could do it. she probably already simps for something.</p>
        </Reveal>

        <ol className="steps">
          <li className="step">
            <span className="step-n" aria-hidden>01</span>
            <div className="step-copy">
              <h3 className="t-h2">earn SIMP&nbsp;Points</h3>
              <p className="t-body">
                check in every day, post about the cult on X and drop the link, bring alpha worth reading. the portal keeps score.
              </p>
              <Link href="/portal" className="link step-link">open the portal</Link>
            </div>
            <ul className="step-panel receipt" aria-label="season-one rates">
              <li><span>daily check-in</span><b className="num">+{whole.format(R.checkin.base)}</b><em>streaks stack up to 2×</em></li>
              <li><span>post on X</span><b className="num">+{whole.format(R.xPost.reward)}</b><em>up to {R.xPost.dailyCap} a day</em></li>
              <li><span>bring alpha</span><b className="num">≤ {compact.format(R.alpha.max)}</b><em>reviewed weekly</em></li>
              <li className="receipt-foot">season-one rates</li>
            </ul>
          </li>

          <li className="step">
            <span className="step-n" aria-hidden>02</span>
            <div className="step-copy">
              <h3 className="t-h2">feed the simp machine</h3>
              <p className="t-body">
                bet points, pull the lever, win more points. or don&apos;t. it&apos;s a slot machine, babe. every spin is settled on
                the server, never in your browser.
              </p>
              <Link href="/games" className="link step-link">see the games</Link>
            </div>
            <div className="step-panel mini-reels" aria-hidden>
              <span className="mini-reel">♥︎</span>
              <span className="mini-reel">7</span>
              <span className="mini-reel">♥︎</span>
            </div>
          </li>

          <li className="step">
            <span className="step-n" aria-hidden>03</span>
            <div className="step-copy">
              <h3 className="t-h2">seasons that halve</h3>
              <p className="t-body">
                {compact.format(POINTS_CONFIG.supply)} points, ever. season one releases half. every {POINTS_CONFIG.season.lengthDays / 7}{" "}
                weeks after that, half of what&apos;s left. it never runs dry and never goes over. early simps eat best.
              </p>
            </div>
            <figure className="step-panel halving">
              <div className="halving-bars">
                {seasons.map((s) => (
                  <div key={s.n} className="halving-col">
                    <span className="halving-val num">{compact.format(s.budget)}</span>
                    <span className="halving-bar" style={{ height: `${Math.max(3, (s.budget / top) * 100)}%` }} />
                    <span className="halving-label">s{s.n}</span>
                  </div>
                ))}
              </div>
              <figcaption className="sr-only">
                points released per season: {seasons.map((s) => `season ${s.n} ${compact.format(s.budget)}`).join(", ")}, and so on.
              </figcaption>
            </figure>
          </li>
        </ol>
      </div>
    </section>
  );
}

/* ── 2 · who earns ─────────────────────────────────────────────────── */
const POOL_COPY: Record<PoolId, { name: string; body: string }> = {
  active: { name: "active simps", body: "holders who show up: check-ins, posts, alpha." },
  holding: { name: "loyal holders", body: "just hold. paid per nft, every day of the season." },
  // the monad card contract is still unconfirmed (BRIEF Q3): until it is set in
  // config the pool is closed, so the copy says "opening soon" instead of "go"
  monad: {
    name: "monad card holders",
    body: MONAD_CARD_ENABLED ? "say “simp” on X, submit the post, get points." : "opening soon. say “simp” on X and get points for it.",
  },
};

export function WhoEarns() {
  return (
    <section className="section section-tight" aria-labelledby="pools-title">
      <div className="shell">
        <Reveal className="section-head">
          <h2 id="pools-title" className="t-h1">whose points are these?</h2>
          <p className="t-lead">yours, mostly. every season&apos;s release is split three ways.</p>
        </Reveal>

        <div className="pools">
          <div className="pool-bar" role="img" aria-label={POOLS.map((p) => `${POOL_COPY[p].name} ${POINTS_CONFIG.poolBps[p] / 100}%`).join(", ")}>
            {POOLS.map((p) => (
              <span key={p} data-pool={p} style={{ flexGrow: POINTS_CONFIG.poolBps[p] }} />
            ))}
          </div>
          <dl className="pool-legend">
            {POOLS.map((p) => (
              <div key={p} data-pool={p}>
                <dt>
                  <span className="pool-pct num">{POINTS_CONFIG.poolBps[p] / 100}%</span>
                  <span className="pool-name">{POOL_COPY[p].name}</span>
                </dt>
                <dd>{POOL_COPY[p].body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/* ── 3 · lore (meme slots) ─────────────────────────────────────────── */
export function Lore() {
  return (
    <section id="lore" className="section" aria-labelledby="lore-title">
      <div className="shell lore">
        <Reveal className="lore-copy">
          <h2 id="lore-title" className="t-h1">why “simp”?</h2>
          <p className="t-lead">
            two guys quit very comfortable jobs to build a new chain from scratch. that isn&apos;t hype. that&apos;s simping for
            something until it&apos;s real.
          </p>
          <p className="t-body">
            a simp shows up every day for the thing they believe in, long before it&apos;s cool. the cult has always worked that way.
            now the machine keeps score.
          </p>
        </Reveal>
        <div className="lore-grid">
          {LORE_SLOTS.map((s, i) => (
            <MediaSlot key={s.id} slot={s} className={`lore-${i + 1}`} label="lore incoming" sizes="(min-width: 900px) 34vw, 62vw" />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── 4 · the collection + holder doors ─────────────────────────────── */
export function Collection() {
  return (
    <section className="section" aria-labelledby="nft-title">
      <div className="shell">
        <Reveal className="section-head section-head-row">
          <div>
            <h2 id="nft-title" className="t-h1">the cult, in pixels</h2>
            <p className="t-lead">
              421 simps on monad. holding one gets you into the holders&apos; chat, the dao and two of the three point pools.
            </p>
          </div>
          <a href={LINKS.opensea} target="_blank" rel="noreferrer" className="btn btn-ghost">
            browse on opensea
          </a>
        </Reveal>

        <div className="nft-strip">
          {NFT_SLOTS.map((s) => (
            <MediaSlot key={s.id} slot={s} className="nft-slot" label="simp loading" sizes="(min-width: 768px) 16vw, 33vw" />
          ))}
        </div>

        <div className="doors">
          <Link href="/join" className="door">
            <span className="door-title">join the holders&apos; chat</span>
            <span className="door-body">prove you hold one, get a single-use telegram invite.</span>
            <span className="door-go" aria-hidden>↗</span>
          </Link>
          <Link href="/dao" className="door">
            <span className="door-title">vote in the simp dao</span>
            <span className="door-body">one nft, one vote, on-chain. no take-backs.</span>
            <span className="door-go" aria-hidden>↗</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
