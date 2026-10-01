"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence, ScrollProgress } from "./motion";
import { LINKS } from "@/lib/config";
import { WalletButton } from "./wallet/WalletButton";
import { Icon } from "./Icon";

function subscribeScroll(cb: () => void) {
  window.addEventListener("scroll", cb, { passive: true });
  return () => window.removeEventListener("scroll", cb);
}

const items = [
  { href: "/", label: "home" },
  { href: "/checker", label: "checker" },
  { href: "/dao", label: "dao" },
  { href: "/verify", label: "holders" },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const scrolled = useSyncExternalStore(subscribeScroll, () => window.scrollY > 24, () => false);

  // close the mobile menu on navigation
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    setOpen(false);
  }

  return (
    <>
      <ScrollProgress />
      <header className="fixed inset-x-0 top-0 z-40 px-4 pt-4">
        <motion.div
          className="mx-auto flex max-w-6xl items-center justify-between rounded-2xl px-4 py-2.5"
          animate={{
            backgroundColor: scrolled || open ? "rgba(13,7,23,0.72)" : "rgba(13,7,23,0)",
            borderColor: scrolled || open ? "rgba(196,168,255,0.13)" : "rgba(196,168,255,0)",
            backdropFilter: scrolled || open ? "blur(18px)" : "blur(0px)",
          }}
          transition={{ duration: 0.35 }}
          style={{ borderWidth: 1, boxShadow: scrolled ? "inset 0 1px 0 rgba(255,255,255,.08), 0 8px 30px -12px rgba(0,0,0,.6)" : "none" }}
        >
          <Link href="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-simp-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-b from-simp to-simp-deep text-white shadow-[inset_0_1px_0_rgba(255,255,255,.3)]">
              s
            </span>
            simp cult
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {items.map((i) => (
              <NavLink key={i.href} href={i.href} label={i.label} active={path === i.href} />
            ))}
            <span className="mx-2 h-5 w-px bg-line" />
            <a href={LINKS.opensea} target="_blank" rel="noreferrer" aria-label="opensea" title="opensea" className="rounded-lg p-2 text-dim transition hover:bg-simp/10 hover:text-white">
              <Icon name="opensea" className="h-[18px] w-[18px]" />
            </a>
            <a href={LINKS.x} target="_blank" rel="noreferrer" aria-label="x / twitter" title="x / twitter" className="rounded-lg p-2 text-dim transition hover:bg-simp/10 hover:text-white">
              <Icon name="x" className="h-4 w-4" />
            </a>
            <div className="ml-2"><WalletButton /></div>
          </nav>

          <button className="btn btn-ghost btn-sm px-2.5 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="menu" aria-expanded={open}>
            <Icon name={open ? "close" : "menu"} className="h-4 w-4" />
          </button>
        </motion.div>

        <AnimatePresence>
          {open && (
            <motion.div
              className="glass mx-auto mt-2 flex max-w-6xl flex-col gap-1 p-3 md:hidden !bg-bg-2/95"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.22 }}
            >
              {items.map((i) => (
                <Link key={i.href} href={i.href} className={`rounded-lg px-3 py-2.5 text-[15px] ${path === i.href ? "bg-simp/15 text-white" : "text-dim"}`}>
                  {i.label}
                </Link>
              ))}
              <div className="mt-1 flex items-center gap-2 px-3 py-2">
                <a href={LINKS.opensea} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm flex-1"><Icon name="opensea" className="h-4 w-4" /> opensea</a>
                <a href={LINKS.x} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm flex-1"><Icon name="x" className="h-3.5 w-3.5" /> x</a>
              </div>
              <div className="px-3 pb-1"><WalletButton className="w-full" /></div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
    </>
  );
}

/* nav item: 1px animated underline + subtle magnetic hover */
function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  function onMove(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!ref.current) return;
    // check reduced-motion inline (avoids motion's dev-only heads-up log)
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const r = ref.current.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) * 0.18;
    const dy = (e.clientY - (r.top + r.height / 2)) * 0.18;
    ref.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  }
  function onLeave() {
    if (!ref.current) return;
    ref.current.style.transform = "";
  }
  return (
    <Link
      ref={ref}
      href={href}
      data-active={active}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`nav-link relative rounded-lg px-3.5 py-2 text-[14px] transition-colors ${active ? "text-white" : "text-dim hover:text-white"}`}
      style={{ transition: "transform 0.35s var(--ease-out), color 0.2s" }}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-lg bg-simp/10"
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
          aria-hidden
        />
      )}
      <span className="relative">{label}</span>
    </Link>
  );
}
