import Link from "next/link";
import { HeroMachine } from "@/components/home/HeroMachine";
import { HowItWorks, WhoEarns, Lore, Collection } from "@/components/home/Pitch";
import { Reveal } from "@/components/motion";

export default function Home() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="shell hero-grid">
          <div>
            <p className="t-wide-sm hero-kicker rise">simp cult presents</p>
            <h1 id="hero-title" className="hero-title rise" style={{ "--d": "0.05s" } as React.CSSProperties}>
              <span>simp</span>
              <span>machine</span>
            </h1>
            <p className="hero-lead rise" style={{ "--d": "0.15s" } as React.CSSProperties}>
              be an active simp. stack SIMP&nbsp;Points. feed them to the machine.
            </p>
            <p className="hero-sub rise" style={{ "--d": "0.2s" } as React.CSSProperties}>
              points drop in six-week seasons, and every season drops half as many as the last. showing up early is the whole
              strategy.
            </p>
            <div className="hero-cta rise" style={{ "--d": "0.28s" } as React.CSSProperties}>
              <Link href="/portal" className="btn btn-primary btn-lg">start earning</Link>
              <Link href="/games" className="btn btn-ghost btn-lg">play the machine</Link>
            </div>
          </div>
          <div className="rise" style={{ "--d": "0.2s" } as React.CSSProperties}>
            <HeroMachine />
          </div>
        </div>
      </section>

      <HowItWorks />
      <WhoEarns />
      <Lore />
      <Collection />

      <section className="section section-tight" aria-labelledby="finale-title">
        <div className="shell">
          <Reveal className="finale">
            <h2 id="finale-title" className="t-h1">the machine is warm.</h2>
            <p className="t-lead">check in today and your streak starts today. tomorrow it&apos;s a day shorter.</p>
            <div className="hero-cta !mt-2">
              <Link href="/portal" className="btn btn-primary btn-lg">start earning</Link>
              <Link href="/join" className="btn btn-ghost btn-lg">verify your simp</Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
