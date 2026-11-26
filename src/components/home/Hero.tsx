import Link from "next/link";
import { CasinoLazy } from "@/casino/CasinoLazy";
import { HeroPoster } from "./HeroPoster";
import s from "./home.module.css";

/**
 * Full-bleed hero. The 3D casino fills the box; on the low tier (and on first
 * paint, before the stage mounts) the static poster fills it instead. The
 * copy sits over both, bottom-left, out of the machine's way.
 */
export function Hero() {
  return (
    <section className={s.hero} aria-labelledby="hero-title">
      <div className={s.stage}>
        <CasinoLazy mode="hero" fallback={<HeroPoster />} className={s.stageCanvas} />
      </div>
      <div className={s.scrim} aria-hidden />

      <div className={`shell ${s.heroCopy}`}>
        <h1 id="hero-title" className={s.heroTitle}>
          <span className="sr-only">simp machine. </span>
          let&rsquo;s go simping.
        </h1>
        <p className={s.heroLead}>
          check in, post about the cult, bring alpha. it all pays in SIMP&nbsp;Points, and there&rsquo;s one machine in
          here that takes them.
        </p>
        <div className={s.heroActions}>
          <Link href="/games/slot" className={`btn btn-primary btn-lg ${s.neonCta}`}>
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
