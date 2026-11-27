import type { Metadata } from "next";
import Link from "next/link";
import { GAMES } from "@/games/registry";
import styles from "./hub.module.css";

export const metadata: Metadata = {
  title: "games",
  description: "put your SIMP Points to work in cult games. first up: the simp machine.",
};

const fmt = (n: number) => n.toLocaleString("en-US");
/** registry copy is written lowercase; the hub sets it in sentence case */
const sentence = (t: string) => t.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());

export default function GamesHub() {
  const live = GAMES.filter((g) => g.status === "live");
  const soon = GAMES.filter((g) => g.status === "soon");
  return (
    <section className={styles.hub}>
      <header className={styles.head}>
        <h1 className={`t-h1 ${styles.title}`}>Games</h1>
        <p className={styles.lead}>
          Your SIMP Points, put to work. Every game is settled on the server, and every result can be checked.
        </p>
      </header>

      <div className={styles.floor}>
        {live.map((g) => (
          <Link key={g.id} href={g.route} className={`${styles.feature} key-host`}>
            <div className={styles.featureArt} aria-hidden>
              <span className={`t-caps ${styles.featureSign}`}>Table {GAMES.indexOf(g) + 1}, lit</span>
              {g.preview && g.preview.length > 0 && (
                <span className={styles.window}>
                  {g.preview.slice(0, 3).map((src) => (
                    <span key={src} className={styles.reel}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- symbol art, any format */}
                      <img src={src} alt="" />
                    </span>
                  ))}
                </span>
              )}
            </div>
            <div className={styles.featureText}>
              <span className={`t-caps num ${styles.stakes}`}>
                {`${fmt(g.minBet)}–${fmt(g.maxBet)} points a ${g.playUnit ?? "play"}`}
              </span>
              <h2 className={styles.name}>{g.name}</h2>
              <p className={styles.tagline}>{sentence(g.tagline)}</p>
              <span className={`btn btn-primary btn-lg ${styles.seat}`}>Take a seat</span>
            </div>
          </Link>
        ))}

        <div className={styles.slips}>
          {soon.map((g) => (
            <div key={g.id} className={styles.slip}>
              <span className={styles.stamp}>Reserved</span>
              <p className={`t-caps ${styles.slipNo}`}>Table {GAMES.indexOf(g) + 1}</p>
              <h2 className={styles.slipName}>{g.name}</h2>
              <p className={styles.slipText}>{sentence(g.tagline)}</p>
            </div>
          ))}
          <p className={styles.house}>
            House rules: points only. The machine keeps a small edge, and tells you exactly how small.
          </p>
        </div>
      </div>
    </section>
  );
}
