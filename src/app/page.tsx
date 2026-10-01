"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useMotionValue, useScroll, useSpring, useTransform, useReducedMotion } from "motion/react";
import { VideoBg } from "@/components/VideoBg";
import { Icon } from "@/components/Icon";
import { Reveal, Stagger, Item, SplitWords, Spotlight, motion } from "@/components/motion";
import { RotatingBadge, PillButton } from "@/components/Liquid";
import { NeonMuse } from "@/components/NeonMuse";
import { LINKS } from "@/lib/config";

const EASE = [0.22, 1, 0.36, 1] as const;

export default function Home() {
  return (
    <>
      <VideoBg src="/media/Homepage.mp4" brightness={0.3} />

      {/* ── hero ─────────────────────────────────────────────── */}
      <Hero />

      {/* ── story ────────────────────────────────────────────── */}
      <section id="story" className="relative overflow-hidden bg-bg-2/85 px-6 py-32 backdrop-blur-xl md:px-8 md:py-44">
        <div className="divider absolute inset-x-0 top-0" />
        <span className="ghost">story</span>

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-20">
          <Reveal>
            <div className="relative mx-auto max-w-sm md:max-w-none">
              <div className="absolute -inset-6 -z-10 rounded-[40px] bg-simp/25 blur-3xl" />
              <Image
                src="/media/story-image.jpg"
                alt="the founders of monad"
                width={520}
                height={520}
                sizes="(min-width: 768px) 520px, 90vw"
                priority
                className="w-full rounded-[28px] border border-line shadow-[0_40px_90px_-30px_rgba(0,0,0,.85),inset_0_1px_0_rgba(255,255,255,.12)]"
              />
            </div>
          </Reveal>

          <Stagger className="space-y-6">
            <Item><p className="t-wide-sm">the lore</p></Item>
            <Item><h2 className="t-h1 text-[clamp(30px,4.2vw,52px)]">conviction, not hype.</h2></Item>
            <Item><p className="t-body">yo, see these guys. they left their high-paying jobs that could&apos;ve given them an easy retirement, and chose to build a new evm from scratch instead. but wait… why should you care?</p></Item>
            <Item><p className="t-body">because in life, things like this remind you what real conviction looks like. the lore of simp isn&apos;t about simping for random things. it&apos;s about simping for what truly matters to you until you actually get it.</p></Item>
            <Item><p className="t-body">$simp and the simp cult nft collection aren&apos;t just a collection or a token. they&apos;re the future of monad, where builders get every tool they need to create what they deserve.</p></Item>
            <Item><p className="t-body">and btw, building apps and dapps is just one side of it. <span className="text-text">building relationships is the real key to everything.</span></p></Item>
            <Item>
              <div className="pt-2">
                <Link href="/checker" className="pillbtn pillbtn-light" aria-label="check eligibility"><span className="pillbtn-label">check eligibility</span><span className="pillbtn-disc">↗</span></Link>
              </div>
            </Item>
          </Stagger>
        </div>
      </section>

      {/* ── three doors ──────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-bg px-6 py-32 md:px-8 md:py-44">
        <div className="divider absolute inset-x-0 top-0" />
        <span className="ghost">doors</span>
        <div className="relative mx-auto max-w-6xl">
          <Reveal className="mb-14 max-w-xl">
            <p className="t-wide-sm mb-4">for the cult</p>
            <h2 className="t-h1 text-[clamp(30px,4.2vw,52px)]">three doors. all need a simp.</h2>
          </Reveal>

          <Stagger className="grid gap-5 md:grid-cols-3">
            <Card href="/checker" n="01" title="wl checker" body="see whether an address made the gtd or fcfs list." cta="check" />
            <Card href="/dao" n="02" title="simp dao" body="holders open proposals and vote on-chain. one nft, one vote, no take-backs." cta="proposals" />
            <Card href="/verify" n="03" title="holders only" body="prove you hold a simp and get into the private telegram." cta="verify" />
          </Stagger>

          {/* neon banner */}
          <Reveal delay={0.1} className="mt-8">
            <Spotlight>
              <a href={LINKS.opensea} target="_blank" rel="noreferrer" className="glass glass-hover grid overflow-hidden md:grid-cols-[220px_1fr]">
                <div className="relative h-44 md:h-full">
                  <Image src="/media/neon-simp.jpg" alt="" fill sizes="(min-width: 768px) 220px, 100vw" className="object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent to-bg-2/90 md:bg-gradient-to-r" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-5 p-7 md:p-9">
                  <div>
                    <p className="t-wide-sm mb-3">the collection</p>
                    <div className="t-h2 text-[24px]">monad simp cult on opensea</div>
                    <div className="mt-2 max-w-[48ch] text-[14.5px] leading-relaxed text-dim">421 simps. browse, buy, or list yours — the 6.9% creator fee goes back to the cult.</div>
                  </div>
                  <span className="pillbtn pillbtn-light"><span className="pillbtn-label">open</span><span className="pillbtn-disc">↗</span></span>
                </div>
              </a>
            </Spotlight>
          </Reveal>
        </div>
      </section>
    </>
  );
}

/* ── hero: cursor-following glow + scroll parallax on the muse ── */
function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  // cursor-following soft glow
  const glowX = useMotionValue(0);
  const glowY = useMotionValue(0);
  const glowXs = useSpring(glowX, { stiffness: 60, damping: 20 });
  const glowYs = useSpring(glowY, { stiffness: 60, damping: 20 });

  // scroll parallax: muse drifts slightly slower than content
  const { scrollY } = useScroll();
  const museY = useTransform(scrollY, [0, 800], [0, reduce ? 0 : -80]);
  const glowScrollY = useTransform(scrollY, [0, 800], [0, reduce ? 0 : -40]);

  useEffect(() => {
    if (reduce) return;
    function onMove(e: MouseEvent) {
      if (!heroRef.current) return;
      const r = heroRef.current.getBoundingClientRect();
      glowX.set(e.clientX - r.left);
      glowY.set(e.clientY - r.top);
    }
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [glowX, glowY, reduce]);

  return (
    <section ref={heroRef} className="relative min-h-[100svh] overflow-hidden">
      {/* soft cursor-tracking glow (desktop only, behind everything) */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -z-[1] hidden h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full md:block"
        style={{
          left: glowXs,
          top: glowYs,
          y: glowScrollY,
          background:
            "radial-gradient(circle, rgba(255,111,224,0.18) 0%, rgba(157,104,255,0.10) 40%, transparent 70%)",
          filter: "blur(30px)",
        }}
      />

      {/* neon muse, right side */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -right-10 top-[14%] opacity-40 md:hidden"><NeonMuse size={300} /></div>
        <motion.div
          style={{ y: museY }}
          className="absolute right-[4%] top-[8%] hidden md:block lg:right-[8%]"
        >
          <NeonMuse size={520} />
        </motion.div>
        <div className="neon-halo absolute right-[6%] top-[18%] hidden md:block" />
      </div>

      <div className="relative mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-center px-6 pb-36 pt-32 md:px-8">
        <motion.p
          className="t-wide-sm mb-6"
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
        >
          we are
        </motion.p>

        <h1 className="t-wide text-[clamp(44px,9.6vw,128px)]">
          <SplitWords text="simp" delay={0.2} />
          <br />
          <SplitWords text="cult" className="grad-text" delay={0.4} />
        </h1>

        <motion.p
          className="mt-8 max-w-[44ch] text-[15px] leading-relaxed text-dim md:text-[16px]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.75, ease: EASE }}
        >
          simping for what truly matters, until you actually get it. the simp cult nft collection, dao and holders&apos;
          circle — built on monad.
        </motion.p>

        <motion.div
          className="mt-10 flex flex-wrap items-center gap-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.9, ease: EASE }}
        >
          <PillButton href={LINKS.opensea} external variant="light" icon={<Icon name="opensea" className="h-4 w-4" />}>
            view on opensea
          </PillButton>
          <Link href="/dao" className="pillbtn pillbtn-dark" aria-label="enter the dao">
            <span className="pillbtn-label">enter the dao</span>
            <span className="pillbtn-disc">→</span>
          </Link>
        </motion.div>

        <motion.div
          className="absolute inset-x-6 bottom-8 flex items-end justify-between md:inset-x-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4, duration: 1 }}
        >
          <div className="flex items-center gap-2">
            <a href={LINKS.x} target="_blank" rel="noreferrer" className="social" aria-label="x / twitter"><Icon name="x" className="h-3.5 w-3.5" /></a>
            <a href={LINKS.opensea} target="_blank" rel="noreferrer" className="social" aria-label="opensea"><Icon name="opensea" className="h-4 w-4" /></a>
            <a href={LINKS.github} target="_blank" rel="noreferrer" className="social" aria-label="github"><Icon name="external" className="h-3.5 w-3.5" /></a>
            {LINKS.telegramBot && <a href={LINKS.telegramBot} target="_blank" rel="noreferrer" className="social" aria-label="telegram"><Icon name="telegram" className="h-4 w-4" /></a>}
          </div>
          <RotatingBadge />
          <div className="invisible flex items-center gap-3 text-xs text-mute md:visible">
            <span className="mono">monad · 143</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Card({ href, n, title, body, cta }: { href: string; n: string; title: string; body: string; cta: string }) {
  return (
    <Item className="h-full">
      <Spotlight className="h-full">
        <Link href={href} className="glass glass-hover group flex h-full flex-col p-7" aria-label={title}>
          <span className="t-wide-sm mb-10 !text-mute">{n}</span>
          <h3 className="t-h3 text-[21px]">{title}</h3>
          <p className="mt-3 flex-1 text-[14.5px] leading-relaxed text-dim">{body}</p>
          <span className="pillbtn pillbtn-dark mt-9 self-start"><span className="pillbtn-label">{cta}</span><span className="pillbtn-disc">→</span></span>
        </Link>
      </Spotlight>
    </Item>
  );
}
