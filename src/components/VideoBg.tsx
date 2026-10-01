"use client";

import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";

/** full-bleed background video with slow parallax + top/bottom fade into the page */
export function VideoBg({ src, brightness = 0.42 }: { src: string; brightness?: number }) {
  const { scrollY } = useScroll();
  const reduce = useReducedMotion();
  const y = useTransform(scrollY, [0, 900], [0, reduce ? 0 : 140]);
  const scale = useTransform(scrollY, [0, 900], [1.04, reduce ? 1.04 : 1.14]);
  const opacity = useTransform(scrollY, [0, 700], [1, 0.35]);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <motion.video
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
        style={{ y, scale, opacity, filter: `brightness(${brightness}) saturate(1.05)` }}
      >
        <source src={src} type="video/mp4" />
      </motion.video>
      <div className="absolute inset-0 bg-gradient-to-b from-bg/40 via-transparent to-bg" />
    </div>
  );
}
