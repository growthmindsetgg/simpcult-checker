"use client";

import { motion, useMotionValue, useSpring, useScroll, useReducedMotion, AnimatePresence, type Variants } from "motion/react";
import { useCallback, useRef, type CSSProperties, type ReactNode, type MouseEvent, type ComponentProps } from "react";

export { motion, AnimatePresence };

const EASE = [0.22, 1, 0.36, 1] as const;

/* ── scroll reveal ─────────────────────────────────────────────── */
export function Reveal({
  children,
  delay = 0,
  y = 22,
  className,
  once = true,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
  as?: "div" | "section" | "li" | "p";
}) {
  // MotionConfig at the root drops y/x under reduced-motion — no per-component gate.
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </Tag>
  );
}

/* ── stagger container + items ────────────────────────────────── */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
export const item: Variants = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
};
export function Stagger({ children, className, ...rest }: { children: ReactNode; className?: string } & ComponentProps<typeof motion.div>) {
  return (
    <motion.div className={className} variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "0px 0px -10% 0px" }} {...rest}>
      {children}
    </motion.div>
  );
}
export function Item({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}

/* ── word-by-word headline reveal ─────────────────────────────── */
export function SplitWords({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  const words = text.split(" ");
  return (
    <span className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.08em] -mb-[0.08em] align-baseline">
          <motion.span
            className="inline-block"
            initial={{ y: "110%", rotate: 4, opacity: 0 }}
            animate={{ y: 0, rotate: 0, opacity: 1 }}
            transition={{ duration: 0.9, ease: EASE, delay: delay + i * 0.07 }}
          >
            {w}
          </motion.span>
          {i < words.length - 1 && " "}
        </span>
      ))}
    </span>
  );
}

/* ── magnetic wrapper (buttons lean toward the cursor) ─────────── */
export function Magnetic({ children, strength = 0.35, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 18, mass: 0.4 });
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 18, mass: 0.4 });
  const reduce = useReducedMotion();
  function move(e: MouseEvent) {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  }
  function leave() {
    x.set(0);
    y.set(0);
  }
  return (
    <motion.div ref={ref} style={{ x, y }} onMouseMove={move} onMouseLeave={leave} className={`inline-block ${className ?? ""}`}>
      {children}
    </motion.div>
  );
}

/* ── spotlight card: pointer spot + 3D tilt (max 6°) ─────────── */
export function Spotlight({
  children,
  className = "",
  tilt = 6,
  ...rest
}: { children: ReactNode; className?: string; tilt?: number | false } & ComponentProps<"div">) {
  const enabled = tilt !== false;
  const max = typeof tilt === "number" ? tilt : 6;
  function move(e: MouseEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
    if (!enabled) return;
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ry", `${px * max * 2}deg`);
    el.style.setProperty("--rx", `${-py * max * 2}deg`);
    el.style.setProperty("--tz", `4px`);
  }
  function leave(e: MouseEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (!enabled) return;
    el.style.setProperty("--rx", `0deg`);
    el.style.setProperty("--ry", `0deg`);
    el.style.setProperty("--tz", `0px`);
  }
  // class list is stable across SSR/CSR — reduced-motion is honoured via the
  // .tilt CSS `@media (prefers-reduced-motion: reduce)` rule in globals.css.
  return (
    <div
      className={`spot ${enabled ? "tilt" : ""} ${className}`}
      onMouseMove={move}
      onMouseLeave={leave}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ── scroll progress line ─────────────────────────────────────── */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 24, mass: 0.3 });
  return <motion.div className="scroll-progress" style={{ scaleX }} aria-hidden />;
}

/* ── 3D tilt on pointer (max 6°) ─────────────────────────────── */
export function Tilt({
  children,
  className = "",
  max = 6,
  style,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const onMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (reduce || !ref.current) return;
      const el = ref.current;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--ry", `${px * max * 2}deg`);
      el.style.setProperty("--rx", `${-py * max * 2}deg`);
      el.style.setProperty("--tz", `4px`);
    },
    [reduce, max],
  );
  const onLeave = useCallback(() => {
    if (!ref.current) return;
    ref.current.style.setProperty("--rx", `0deg`);
    ref.current.style.setProperty("--ry", `0deg`);
    ref.current.style.setProperty("--tz", `0px`);
  }, []);
  return (
    <div ref={ref} className={`tilt ${className}`} style={style} onMouseMove={onMove} onMouseLeave={onLeave}>
      {children}
    </div>
  );
}

/* ── press ripple: pass to onPointerDown ─────────────────────── */
export function spawnRipple(e: React.PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  if (!el.classList.contains("ripple")) el.classList.add("ripple");
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.1;
  const dot = document.createElement("span");
  dot.className = "ripple-dot";
  dot.style.width = dot.style.height = `${size}px`;
  dot.style.left = `${e.clientX - r.left}px`;
  dot.style.top = `${e.clientY - r.top}px`;
  el.appendChild(dot);
  setTimeout(() => dot.remove(), 700);
}

/* wrap children and forward the ripple to any child button/anchor */
export function Ripple({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`ripple ${className}`}
      onPointerDown={(e) => spawnRipple(e as unknown as React.PointerEvent<HTMLElement>)}
    >
      {children}
    </span>
  );
}

/* ── modal shell with spring ──────────────────────────────────── */
export function ModalShell({ open, onClose, children, className = "max-w-md" }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
        >
          <motion.div
            className={`glass w-full p-6 md:p-7 ${className}`}
            role="dialog"
            aria-modal
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.7 }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
