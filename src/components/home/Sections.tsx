import Image from "next/image";
import Link from "next/link";
import { MONAD_CARD_ENABLED, POINTS_CONFIG, POOLS, seasonBudget, type PoolId } from "@/lib/points/config";
import { LINKS } from "@/lib/config";
import { Reveal } from "@/components/motion";
import { Heart } from "@/components/Logo";
import { Dealt } from "./Dealt";
import s from "./home.module.css";

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
      <div className={`shell ${s.earnGrid}`}>
        <Reveal className={s.earnCopy}>
          <h2 id="earn-title" className={s.h2}>
            how a simp earns.
          </h2>
          <p className={s.lead}>
            three habits. the portal counts every one of them, and the count is paid in SIMP&nbsp;Points. no forms, no quests, no
            grinding a dashboard.
          </p>
          <Link href="/portal" className="link">
            open the portal
          </Link>
        </Reveal>

        <Dealt className={s.slips}>
          {/* 1 · the daily habit: the biggest slip, because it's the one that matters */}
          <article className={`${s.ticket} ${s.ticketA}`} aria-labelledby="t-checkin">
            <div className={s.paper}>
              <div className={s.ticketBody}>
                <p className={s.ticketSerial}>daily · resets 00:00 utc</p>
                <h3 id="t-checkin" className={s.ticketTitle}>
                  say gsimp
                </h3>
                <dl className={s.ledger}>
                  <div>
                    <dt>check in</dt>
                    <dd>+{whole.format(R.checkin.base)}</dd>
                  </div>
                  <div>
                    <dt>streak bonus</dt>
                    <dd>+{Math.round(R.checkin.streakBonusPerDay * 100)}% a day</dd>
                  </div>
                  <div>
                    <dt>ceiling</dt>
                    <dd>
                      {cap}× from day {capDay}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className={s.ticketStub} aria-hidden>
                <span>admit one</span>
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
                <p className={s.ticketSerial}>up to {R.xPost.dailyCap} a day</p>
                <h3 id="t-post" className={s.ticketTitle}>
                  post on x
                </h3>
                <p className={s.ticketNote}>talk about the cult, drop the link in the portal. the bot reads it and pays out.</p>
                <p className={s.ticketBig}>
                  +{whole.format(R.xPost.reward)}
                  <small> a post</small>
                </p>
              </div>
            </div>
          </article>

          {/* 3 · alpha: brass, because a human reads it */}
          <article className={s.plaque} aria-labelledby="t-alpha">
            <p className={s.plaqueKicker}>reviewed weekly by the cabal</p>
            <h3 id="t-alpha" className={s.plaqueTitle}>
              bring alpha
            </h3>
            <p className={s.plaqueNote}>
              a thread, a tool, a find worth reading. up to <b>{whole.format(R.alpha.max)}</b> points each.
            </p>
          </article>
        </Dealt>
      </div>
    </section>
  );
}

/* ── the house rules: the split + the halving, engraved ───────────── */
const POOL_COPY: Record<PoolId, { name: string; body: string }> = {
  active: { name: "active simps", body: "holders who show up: check-ins, posts, alpha." },
  holding: { name: "loyal holders", body: "just hold. paid per nft, every day of the season." },
  monad: {
    name: "monad card holders",
    body: MONAD_CARD_ENABLED
      ? "say “simp” on x, submit the post, get points."
      : "opening soon. say “simp” on x and get points for it.",
  },
};

export function House() {
  const seasons = Array.from({ length: 6 }, (_, i) => ({ n: i + 1, budget: seasonBudget(i + 1) }));
  const weeks = POINTS_CONFIG.season.lengthDays / 7;
  return (
    <section id="house" className={`section ${s.houseSection}`} aria-labelledby="house-title">
      <div className="shell">
        <div className={s.board}>
          <header className={s.boardHead}>
            <h2 id="house-title" className={s.h2}>
              the house rules
            </h2>
            <p className={s.boardLead}>
              {whole.format(POINTS_CONFIG.supply)} SIMP&nbsp;Points, ever. this is where they go and when.
            </p>
          </header>

          <div className={s.boardGrid}>
            <div>
              <h3 className={s.boardLabel}>who gets them</h3>
              <dl className={s.split}>
                {POOLS.map((p) => (
                  <div key={p} className={s.splitRow} data-pool={p}>
                    <dt>
                      <span className={s.splitNum}>
                        {pct(p)}
                        <span className={s.splitPct}>%</span>
                      </span>
                      <span className={s.splitName}>{POOL_COPY[p].name}</span>
                    </dt>
                    <dd>{POOL_COPY[p].body}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className={s.seasonsCol}>
              <h3 className={s.boardLabel}>when they drop</h3>
              <p className={s.seasonCopy}>
                season one pays out {compact.format(seasons[0].budget)}. every {weeks} weeks the next season pays half the last.
                it never runs dry and it never goes over.
              </p>
              <figure className={s.chips}>
                <div className={s.chipRow}>
                  {seasons.map((x) => {
                    const count = Math.max(1, Math.round(24 * (x.budget / seasons[0].budget)));
                    return (
                      <div key={x.n} className={s.chipCol}>
                        <div className={s.stack} style={{ "--n": count } as React.CSSProperties}>
                          {Array.from({ length: count }, (_, k) => (
                            <i key={k} />
                          ))}
                        </div>
                        <span className={s.chipVal}>{compact.format(x.budget)}</span>
                        <span className={s.chipSeason}>s{x.n}</span>
                      </div>
                    );
                  })}
                  <div className={s.chipCol} aria-hidden>
                    <div className={s.stackGhost} />
                    <span className={s.chipVal}>…</span>
                    <span className={s.chipSeason}>forever</span>
                  </div>
                </div>
                <figcaption className="sr-only">
                  points released per season: {seasons.map((x) => `season ${x.n} ${compact.format(x.budget)}`).join(", ")},
                  halving forever.
                </figcaption>
              </figure>
              <p className={s.wink}>points that might mean something someday.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── lore ─────────────────────────────────────────────────────────── */
const YEARS = [
  { y: "1903", t: "a simp is a simpleton. we're carrying on the family business." },
  { y: "1980s", t: "west coast rap makes it mean soft-hearted. guilty." },
  { y: "2020", t: "“ok simp.” crypto twitter learns the word in about an hour." },
  { y: "2025", t: "421 simps deploy on monad's mainnet day. the word becomes a vow." },
];

export function Lore() {
  return (
    <section id="lore" className={`section ${s.lore}`} aria-labelledby="lore-title">
      <div className={`shell ${s.loreGrid}`}>
        <div className={s.loreHead}>
          <h2 id="lore-title" className={s.loreTitle}>
            once an insult. now a vow.
          </h2>
          <p className={s.lead}>
            a simp shows up every day for the thing they believe in, long before it&rsquo;s cool. not for a person. for the chain,
            the cult, the craft. the machine just keeps score.
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

/* ── the collection: a wall of brass frames ───────────────────────── */
const PORTRAITS = [137, 1, 81, 300, 390, 421];

export function Portraits() {
  return (
    <section id="collection" className={`section ${s.portraits}`} aria-labelledby="nft-title">
      <div className={`shell ${s.portraitGrid}`}>
        <div className={s.portraitCopy}>
          <h2 id="nft-title" className={s.h2}>
            421 simps hang on this wall.
          </h2>
          <p className={s.lead}>holding one puts you in two of the three point pools, the holders&rsquo; chat and the dao.</p>
          <ul className={s.doors}>
            <li>
              <Link href="/join" className="link">
                join the holders&rsquo; chat
              </Link>
            </li>
            <li>
              <Link href="/dao" className="link">
                vote in the simp dao
              </Link>
            </li>
            <li>
              <a href={LINKS.opensea} target="_blank" rel="noreferrer" className="link">
                browse the collection
              </a>
            </li>
          </ul>
        </div>
        <ul className={s.wall}>
          {PORTRAITS.map((n, i) => (
            <li key={n} className={i === 0 ? `${s.cell} ${s.cellBig}` : s.cell}>
              <div className={s.brass}>
                <div className={s.mat}>
                  <Image
                    src={`/media/nft/simp-${n}.webp`}
                    alt={`simp cult #${n}`}
                    width={480}
                    height={480}
                    sizes={i === 0 ? "(min-width: 900px) 30vw, 66vw" : "(min-width: 900px) 14vw, 33vw"}
                  />
                </div>
              </div>
              <span className={s.plate}>no. {n}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── closing ──────────────────────────────────────────────────────── */
export function Finale() {
  return (
    <section className={`section ${s.finale}`} aria-labelledby="finale-title">
      <div className={`shell ${s.finaleInner}`}>
        <h2 id="finale-title" className={s.finaleTitle}>
          the machine is warm.
        </h2>
        <div className={s.finaleSide}>
          <p className={s.lead}>check in today and your streak starts today. tomorrow it&rsquo;s a day shorter.</p>
          <div className={s.heroActions}>
            <Link href="/portal" className={`btn btn-primary btn-lg ${s.neonCta}`}>
              say gsimp
            </Link>
            <Link href="/games/slot" className={s.quietCta}>
              or pull the lever
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
