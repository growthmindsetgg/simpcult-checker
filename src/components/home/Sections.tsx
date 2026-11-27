import Image from "next/image";
import Link from "next/link";
import { MONAD_CARD_ENABLED, POINTS_CONFIG, POOLS, seasonBudget, type PoolId } from "@/lib/points/config";
import { LINKS } from "@/lib/config";
import { Heart } from "@/components/Logo";
import { Dealt } from "./Dealt";
import s from "./home.module.css";

/*
 * The home page after the hero, one layout per section (no repeated template):
 *   earn    night band   three slips dealt across the counter
 *   house   lavender     one cream pay-table card
 *   lore    Monad fill   one compact strip of dates
 *   wall    lavender     the collection, full bleed (the only plates on the page)
 * The closing call lives in the footer.
 */

const whole = new Intl.NumberFormat("en");
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const R = POINTS_CONFIG.rewards;
const pct = (p: PoolId) => POINTS_CONFIG.poolBps[p] / 100;

/* ── how a simp earns: three slips of different stock ─────────────── */
export function Earn() {
  const cap = 1 + R.checkin.maxStreakBonus;
  const capDay = Math.round(R.checkin.maxStreakBonus / R.checkin.streakBonusPerDay) + 1;
  return (
    <section id="earn" className={`section ${s.earn}`} aria-labelledby="earn-title">
      <div className="shell">
        <header className={s.earnHead}>
          <h2 id="earn-title" className={`t-caps ${s.label}`}>
            How a simp earns
          </h2>
          <p className={s.earnLead}>
            Three habits. Each day’s points are shared by everyone who shows up, weighted by what you did. Quiet days pay
            more each.
          </p>
          <p className={s.earnNote}>Add your Telegram for 3× weight on every check-in and post.</p>
          <Link href="/portal" className={`link ${s.earnLink}`}>
            Open the portal
          </Link>
        </header>

        <Dealt className={s.slips}>
          {/* 1 · the daily habit: the biggest slip, because it's the one that matters */}
          <article className={`${s.ticket} ${s.ticketA}`} aria-labelledby="t-checkin">
            <div className={s.paper}>
              <div className={s.ticketBody}>
                <p className={s.ticketSerial}>Daily, resets 00:00 UTC</p>
                <h3 id="t-checkin" className={s.ticketTitle}>
                  Say gsimp
                </h3>
                <dl className={s.ledger}>
                  <div>
                    <dt>Check in</dt>
                    <dd>weight {whole.format(R.checkin.base)}</dd>
                  </div>
                  <div>
                    <dt>Streak bonus</dt>
                    <dd>+{Math.round(R.checkin.streakBonusPerDay * 100)}% weight a day</dd>
                  </div>
                  <div>
                    <dt>Ceiling</dt>
                    <dd>
                      {cap}× from day {capDay}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className={s.ticketStub} aria-hidden>
                <span>Admit one</span>
              </div>
              <span className={s.stamp} aria-hidden>
                <Heart className={s.stampHeart} />
                daily
              </span>
            </div>
          </article>

          {/* 2 · posting */}
          <article className={`${s.ticket} ${s.ticketB}`} aria-labelledby="t-post">
            <div className={s.paper}>
              <div className={s.ticketBody}>
                <p className={s.ticketSerial}>Up to {R.xPost.dailyCap} a day</p>
                <h3 id="t-post" className={s.ticketTitle}>
                  Post on X
                </h3>
                <p className={s.ticketNote}>
                  Talk about the cult, drop the link in the portal. The bot reads it, pays a slice now and your share of the
                  day’s pool at midnight UTC.
                </p>
                <p className={s.ticketBig}>
                  {whole.format(R.xPost.reward)}
                  <small> weight a post</small>
                </p>
              </div>
            </div>
          </article>

          {/* 3 · alpha: brass, because a human reads it */}
          <article className={s.plaque} aria-labelledby="t-alpha">
            <p className={s.plaqueKicker}>Reviewed weekly by the cabal</p>
            <h3 id="t-alpha" className={s.plaqueTitle}>
              Bring alpha
            </h3>
            <p className={s.plaqueNote}>
              A thread, a tool, a find worth reading. Weighs up to <b>{whole.format(R.alpha.max)}</b> in the day’s pool.
            </p>
          </article>
        </Dealt>
      </div>
    </section>
  );
}

/* ── the house rules: one printed pay table ───────────────────────── */
const POOL_COPY: Record<PoolId, { name: string; body: string }> = {
  active: {
    name: "Active simps",
    body: "Holders who show up: check-ins, posts, alpha. 10% is shared out day by day; 90% is split at season end among holders who post in the final 48 hours.",
  },
  holding: {
    name: "Loyal holders",
    body: "Just hold. Counted per NFT every day, paid once at season end. Hold through 5 surprise snapshots.",
  },
  monad: {
    name: "Community",
    body: MONAD_CARD_ENABLED
      ? "Monad Card holders (9%) and active Monad users with 50+ transactions (1%). Say “simp” on X and submit the post. Same daily and season-end split."
      : "Active Monad users with 50+ transactions: say “simp” on X and submit the post. Monad Card holders join when the card opens.",
  },
};

export function House() {
  const seasons = Array.from({ length: 6 }, (_, i) => ({ n: i + 1, budget: seasonBudget(i + 1) }));
  const weeks = POINTS_CONFIG.season.lengthDays / 7;
  return (
    <section id="house" className={`section band-lav on-light ${s.house}`} aria-labelledby="house-title">
      <div className="shell">
        <article className={s.card}>
          <header className={s.cardHead}>
            <h2 id="house-title" className={s.cardTitle}>
              The house rules
            </h2>
            <p className={s.cardLead}>
              <span className={s.cardFigure}>{whole.format(POINTS_CONFIG.supply)}</span> SIMP&nbsp;Points, ever. Here is where
              they go, season by season.
            </p>
          </header>

          <div className={s.cardGrid}>
            <div>
              <h3 className={`t-caps ${s.cardLabel}`}>Who gets them</h3>
              <dl className={s.split}>
                {POOLS.map((p) => (
                  <div key={p} className={s.splitRow}>
                    <dt>
                      <span className={s.splitName}>{POOL_COPY[p].name}</span>
                      <span className={s.splitLeader} aria-hidden />
                      <span className={s.splitNum}>
                        {pct(p)}
                        <span className={s.splitPct}>%</span>
                      </span>
                    </dt>
                    <dd>{POOL_COPY[p].body}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className={s.seasonsCol}>
              <h3 className={`t-caps ${s.cardLabel}`}>Season by season</h3>
              <p className={s.seasonCopy}>
                Season one pays out {compact.format(seasons[0].budget)}. Every {weeks} weeks the next season pays half the last. It
                never runs dry and it never goes over.
              </p>
              <figure className={s.chips}>
                <div className={s.chipRow}>
                  {seasons.map((x) => {
                    const count = Math.max(1, Math.round(22 * (x.budget / seasons[0].budget)));
                    return (
                      <div key={x.n} className={s.chipCol}>
                        <div className={s.stack} style={{ "--n": count } as React.CSSProperties}>
                          {Array.from({ length: count }, (_, k) => (
                            <i key={k} />
                          ))}
                        </div>
                        <span className={s.chipVal}>{compact.format(x.budget)}</span>
                        <span className={s.chipSeason}>S{x.n}</span>
                      </div>
                    );
                  })}
                  <div className={s.chipCol} aria-hidden>
                    <div className={s.stackGhost} />
                    <span className={s.chipVal}>…</span>
                    <span className={s.chipSeason}>Forever</span>
                  </div>
                </div>
                <figcaption className="sr-only">
                  Points released per season: {seasons.map((x) => `season ${x.n} ${compact.format(x.budget)}`).join(", ")},
                  halving forever.
                </figcaption>
              </figure>
            </div>
          </div>

          <p className={s.wink}>Points for the record. Nothing more, nothing less.</p>
        </article>
      </div>
    </section>
  );
}

/* ── lore: one strip of dates on Monad purple ─────────────────────── */
const YEARS = [
  { y: "1903", t: "A simp is a simpleton. We’re carrying on the family business." },
  { y: "1980s", t: "West Coast rap makes it mean soft-hearted. Guilty." },
  { y: "2020", t: "“Ok simp.” Crypto Twitter learns the word in about an hour." },
  { y: "2025", t: "421 simps deploy on Monad’s mainnet day. The word becomes a vow." },
];

export function Lore() {
  return (
    <section id="lore" className={`band-monad ${s.lore}`} aria-labelledby="lore-title">
      <div className={`shell ${s.loreGrid}`}>
        <div className={s.loreHead}>
          <h2 id="lore-title" className={`t-caps ${s.loreLabel}`}>
            Once an insult, now a vow
          </h2>
          <p className={s.loreLead}>
            A simp shows up every day for the thing they believe in, long before it’s cool. The machine just keeps score.
          </p>
        </div>
        <ol className={s.years}>
          {YEARS.map((x) => (
            <li key={x.y}>
              <span className={s.year}>{x.y}</span>
              <span className={s.yearText}>{x.t}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── the collection: full-bleed wall on a lavender field ──────────── */
const PORTRAITS = [137, 1, 81, 300, 390, 421];

export function Portraits() {
  return (
    <section id="collection" className={`section band-lav on-light ${s.wallSection}`} aria-labelledby="nft-title">
      <div className={`shell ${s.wallHead}`}>
        <h2 id="nft-title" className={s.wallTitle}>
          421 simps hang on this wall.
        </h2>
        <div className={s.wallSide}>
          <p className={s.wallLead}>Holding one puts you in two of the three point pools, the holders’ chat and the DAO.</p>
          <ul className={s.doors}>
            <li>
              <Link href="/join" className="link">
                Join the holders’ chat
              </Link>
            </li>
            <li>
              <Link href="/dao" className="link">
                Vote in the Simp DAO
              </Link>
            </li>
            <li>
              <a href={LINKS.opensea} target="_blank" rel="noreferrer" className="link">
                Browse the collection
              </a>
            </li>
          </ul>
        </div>
      </div>
      <ul className={s.wall}>
        {PORTRAITS.map((n) => (
          <li key={n} className={s.cell}>
            <div className={s.brass}>
              <div className={s.mat}>
                <Image
                  src={`/media/nft/simp-${n}.webp`}
                  alt={`Simp Cult #${n}`}
                  width={480}
                  height={480}
                  sizes="(min-width: 900px) 16vw, 33vw"
                />
              </div>
            </div>
            <span className="plate num">No. {n}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── closing: folded into the footer (FooterCall). kept as an export for page.tsx ── */
export function Finale() {
  return null;
}
