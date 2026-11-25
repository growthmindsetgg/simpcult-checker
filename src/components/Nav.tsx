"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence, ScrollProgress } from "./motion";
import { LINKS } from "@/lib/config";
import { WalletButton } from "./wallet/WalletButton";
import { Icon } from "./Icon";
import { Logo } from "./Logo";

function subscribeScroll(cb: () => void) {
  window.addEventListener("scroll", cb, { passive: true });
  return () => window.removeEventListener("scroll", cb);
}

export const NAV_ITEMS = [
  { href: "/portal", label: "portal" },
  { href: "/games", label: "games" },
  { href: "/join", label: "join" },
  { href: "/dao", label: "dao" },
];

const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const scrolled = useSyncExternalStore(subscribeScroll, () => window.scrollY > 16, () => false);

  // close the mobile menu on navigation
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    setOpen(false);
  }

  const solid = scrolled || open;

  return (
    <>
      <ScrollProgress />
      <header className="fixed inset-x-0 top-0 z-40 px-3 pt-3 md:px-4 md:pt-4">
        <div
          className={`mx-auto flex max-w-[1232px] items-center justify-between gap-3 rounded-full border py-2 pl-3 pr-2 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 md:pl-4 ${
            solid
              ? "border-line bg-bg-2/80 shadow-[inset_0_1px_0_rgba(255,255,255,.07),0_10px_30px_-14px_rgba(10,0,8,.8)] backdrop-blur-xl"
              : "border-transparent bg-transparent"
          }`}
        >
          <Link href="/" className="flex items-center gap-2.5 rounded-full pr-2" aria-label="simp machine, home">
            <Logo className="h-8 w-8" />
            <span className="font-wide text-[12px] uppercase tracking-[0.16em] text-simp-50">simp machine</span>
          </Link>

          <nav aria-label="main" className="hidden items-center gap-0.5 md:flex">
            {NAV_ITEMS.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                data-active={isActive(path, i.href)}
                aria-current={isActive(path, i.href) ? "page" : undefined}
                className={`nav-link rounded-full px-3.5 py-2 text-[14px] font-medium transition-colors lg:px-4 ${
                  isActive(path, i.href) ? "text-white" : "text-dim hover:text-white"
                }`}
              >
                {i.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-1 md:flex">
            <a href={LINKS.x} target="_blank" rel="noreferrer" aria-label="simp cult on x" className="hidden rounded-full p-2.5 text-dim transition-colors hover:bg-simp/10 hover:text-white lg:block">
              <Icon name="x" className="h-4 w-4" />
            </a>
            <a href={LINKS.opensea} target="_blank" rel="noreferrer" aria-label="collection on opensea" className="hidden rounded-full p-2.5 text-dim transition-colors hover:bg-simp/10 hover:text-white lg:block">
              <Icon name="opensea" className="h-[18px] w-[18px]" />
            </a>
            <div className="ml-1">
              <WalletButton className="btn-sm" />
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm w-10 px-0 md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "close menu" : "open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
          >
            <Icon name={open ? "close" : "menu"} className="h-4 w-4" />
          </button>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              id="mobile-menu"
              className="glass mx-auto mt-2 flex max-w-[1232px] flex-col gap-1 !rounded-[24px] !bg-bg-2/95 p-3 md:hidden"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12 } }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              style={{ transformOrigin: "top right" }}
            >
              <nav aria-label="main" className="flex flex-col gap-1">
                {NAV_ITEMS.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    aria-current={isActive(path, i.href) ? "page" : undefined}
                    className={`rounded-2xl px-4 py-3 text-[16px] font-medium ${isActive(path, i.href) ? "bg-simp/15 text-white" : "text-dim"}`}
                  >
                    {i.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-1 flex items-center gap-2 px-1 pt-1">
                <a href={LINKS.opensea} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm flex-1"><Icon name="opensea" className="h-4 w-4" /> opensea</a>
                <a href={LINKS.x} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm flex-1"><Icon name="x" className="h-3.5 w-3.5" /> x</a>
              </div>
              <div className="px-1 pb-1 pt-1"><WalletButton className="w-full" /></div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
    </>
  );
}
