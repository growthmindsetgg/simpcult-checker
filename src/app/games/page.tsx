import "@fontsource-variable/bodoni-moda";
import "@fontsource-variable/bodoni-moda/wght-italic.css";
import "@fontsource-variable/jetbrains-mono";
import type { Metadata } from "next";
import Link from "next/link";
import { GAMES } from "@/games/registry";
import styles from "./hub.module.css";

export const metadata: Metadata = {
  title: "games",
  description: "put your SIMP Points to work in cult games. first up: the simp machine.",
};

const fmt = (n: number) => n.toLocaleString("en-US");

export default function GamesHub() {
  const live = GAMES.filter((g) => g.status === "live");
  const soon = GAMES.filter((g) => g.status === "soon");
  return (
    <section className={styles.hub}>
      <header className={styles.head}>
        <p className={styles.kicker}>the back room</p>
        <h1 className={styles.title}>games</h1>
        <p className={styles.lead}>
          your SIMP Points, put to work. every game is settled on the server, and every result can be checked.
        </p>
      </header>

      <div className={styles.floor}>
        {live.map((g) => (
          <Link key={g.id} href={g.route} className={styles.feature}>
            <div className={styles.featureArt} aria-hidden>
              <span className={styles.featureSign}>table no. {String(GAMES.indexOf(g) + 1).padStart(2, "0")} · lit</span>
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
              <span className={styles.plaque}>
                {fmt(g.minBet)} – {fmt(g.maxBet)} points a {g.playUnit ?? "play"}
              </span>
              <h2 className={styles.name}>{g.name}</h2>
              <p className={styles.tagline}>{g.tagline}</p>
              <span className={styles.cta}>take a seat</span>
            </div>
          </Link>
        ))}

        <div className={styles.slips}>
          {soon.map((g) => (
            <div key={g.id} className={styles.slip}>
              <span className={styles.stamp}>reserved</span>
              <p className={styles.slipNo}>table no. {String(GAMES.indexOf(g) + 1).padStart(2, "0")}</p>
              <h2 className={styles.slipName}>{g.name.toLowerCase()}</h2>
              <p className={styles.slipText}>{g.tagline}</p>
            </div>
          ))}
          <p className={styles.house}>
            house rules: points only. the machine keeps a small edge, and tells you exactly how small.
          </p>
        </div>
      </div>
    </section>
  );
}
