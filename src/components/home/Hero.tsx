import Link from "next/link";
import { CasinoLazy } from "@/casino/CasinoLazy";
import { HeroPoster } from "./HeroPoster";
import s from "./home.module.css";

/**
 * Full-bleed hero. The poster (a still of the 3D stage's resting frame) is
 * always painted first, in the server HTML; the live 3D casino mounts over it
 * and fades in once it draws. On the low tier the poster is the hero. The
 * copy sits over both, bottom-left, out of the machine's way.
 */
export function Hero() {
  return (
    <section className={s.hero} aria-labelledby="hero-title">
      <div className={s.stage}>
        <HeroPoster />
        <CasinoLazy mode="hero" fallback={null} className={s.stageCanvas} />
      </div>
      <div className={s.scrim} aria-hidden />

      <div className={`shell ${s.heroCopy}`}>
        <h1 id="hero-title" className={s.heroTitle}>
          <span className="sr-only">simp machine. </span>
          let&rsquo;s go simping.
        </h1>
        <p className={s.heroLead}>
          Check in, post about the cult, bring alpha. It all pays in SIMP&nbsp;Points, and there&rsquo;s one machine in
          here that takes them.
        </p>
        <div className={s.heroActions}>
          <Link href="/games/slot" className="btn btn-primary btn-lg">
            play the machine
          </Link>
          <Link href="/portal" className={s.quietCta}>
            start earning
          </Link>
        </div>
      </div>
    </section>
  );
}
