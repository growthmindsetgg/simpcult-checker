"use client";

import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "motion/react";
import { useEffect } from "react";

/** wraps children in gentle mouse-parallax (depth 0..1) */
export function Parallax({ children, depth = 0.5, className = "" }: { children: React.ReactNode; depth?: number; className?: string }) {
  const reduce = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(useTransform(mx, (v) => v * 40 * depth), { stiffness: 60, damping: 20 });
  const y = useSpring(useTransform(my, (v) => v * 30 * depth), { stiffness: 60, damping: 20 });
  const rx = useSpring(useTransform(my, (v) => v * -6 * depth), { stiffness: 60, damping: 20 });
  const ry = useSpring(useTransform(mx, (v) => v * 8 * depth), { stiffness: 60, damping: 20 });

  useEffect(() => {
    if (reduce) return;
    const f = (e: MouseEvent) => {
      mx.set((e.clientX / window.innerWidth - 0.5) * 2);
      my.set((e.clientY / window.innerHeight - 0.5) * 2);
    };
    window.addEventListener("mousemove", f, { passive: true });
    return () => window.removeEventListener("mousemove", f);
  }, [mx, my, reduce]);

  return (
    <motion.div className={className} style={{ x, y, rotateX: rx, rotateY: ry, transformPerspective: 900 }}>
      {children}
    </motion.div>
  );
}

/** circular rotating text badge ("scroll down · simp cult ·") */
export function RotatingBadge({ text = "scroll down · simp cult · scroll down · ", href = "#story" }: { text?: string; href?: string }) {
  return (
    <a href={href} className="badge-rotate group" aria-label="scroll down">
      <svg viewBox="0 0 100 100" className="h-full w-full">
        <defs>
          <path id="badge-circle" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" />
        </defs>
        <text className="fill-current text-[8.2px] uppercase tracking-[0.18em]" style={{ fontFamily: "var(--font-inter)" }}>
          <textPath href="#badge-circle">{text}</textPath>
        </text>
      </svg>
      <span className="badge-arrow">↓</span>
    </a>
  );
}

/** pill button with an icon disc on the right, like the reference */
export function PillButton({
  children,
  icon = "↗",
  href,
  onClick,
  external,
  variant = "light",
  className = "",
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  external?: boolean;
  variant?: "light" | "dark" | "simp";
  className?: string;
}) {
  const cls = `pillbtn pillbtn-${variant} ${className}`;
  const inner = (
    <>
      <span className="pillbtn-label">{children}</span>
      <span className="pillbtn-disc">{icon}</span>
    </>
  );
  if (href)
    return (
      <a href={href} className={cls} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {inner}
      </a>
    );
  return (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}
