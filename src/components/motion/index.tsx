"use client";

import { motion, AnimatePresence, type Variants } from "motion/react";
import { useEffect, type ReactNode, type MouseEvent, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "@/lib/useMounted";

export { motion, AnimatePresence };

const EASE = [0.23, 1, 0.32, 1] as const; // UI: modals, list items
const REVEAL = [0.19, 1, 0.22, 1] as const; // expo-out: scroll reveals only (--ease-reveal)

/* ── scroll reveal (used sparingly: one reveal per section at most) ── */
export function Reveal({
  children,
  delay = 0,
  y = 12,
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
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.8, ease: REVEAL, delay }}
    >
      {children}
    </Tag>
  );
}

/* ── stagger container + items ────────────────────────────────── */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.03 } },
};
export const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
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

/* ── spotlight: a warm lamp follows the pointer (no tilt; tilting cards read as gimmicky) ── */
export function Spotlight({
  children,
  className = "",
  tilt: _tilt,
  ...rest
}: { children: ReactNode; className?: string; tilt?: number | false } & ComponentProps<"div">) {
  void _tilt;
  function move(e: MouseEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }
  return (
    <div className={`spot relative ${className}`} onMouseMove={move} {...rest}>
      {children}
    </div>
  );
}

/* ── modal: a velvet panel over a dimmed room ─────────────────── */
/* portalled to <body> so no ancestor (the nav, the mobile menu's clip-path) can clip or cover it */
export function ModalShell({ open, onClose, children, className = "max-w-md" }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const mounted = useMounted();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center overscroll-contain bg-[rgba(14,9,28,0.72)] p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className={`glass max-h-[calc(100dvh-2rem)] w-full overflow-y-auto !rounded-[var(--key-radius-xl)] p-6 md:p-7 ${className}`}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.15 } }}
            transition={{ duration: 0.26, ease: EASE }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
