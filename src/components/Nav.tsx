"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LINKS } from "@/lib/config";
import { WalletButton } from "./wallet/WalletButton";
import { Logo } from "./Logo";
import s from "./chrome.module.css";

function subscribeScroll(cb: () => void) {
  window.addEventListener("scroll", cb, { passive: true });
  return () => window.removeEventListener("scroll", cb);
}

export const NAV_ITEMS = [
  { href: "/games/slot", match: "/games", label: "machine", note: "spin your points" },
  { href: "/portal", match: "/portal", label: "earn", note: "check in, post, bring alpha" },
  { href: "/dao", match: "/dao", label: "dao", note: "one nft, one vote" },
  { href: "/join", match: "/join", label: "join", note: "the holders' chat" },
];

const isActive = (path: string, match: string) => path === match || path.startsWith(`${match}/`);

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const scrolled = useSyncExternalStore(subscribeScroll, () => window.scrollY > 12, () => false);
  const firstLink = useRef<HTMLAnchorElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  // close the menu on navigation
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    setOpen(false);
  }

  // menu open: lock scroll, Escape closes, focus moves in and back out
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    firstLink.current?.focus({ preventScroll: true });
    const btn = toggle.current;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      btn?.focus({ preventScroll: true });
    };
  }, [open]);

  // see-through only over the home hero, before the first scroll
  const clear = path === "/" && !scrolled && !open;

  return (
    <header className={s.nav} data-clear={clear} data-open={open}>
      <div className={s.bar}>
        <Link href="/" className={s.brand} aria-label="simp machine, home">
          <Logo />
        </Link>

        <nav aria-label="main" className={s.links}>
          {NAV_ITEMS.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={s.link}
              aria-current={isActive(path, i.match) ? "page" : undefined}
            >
              {i.label}
            </Link>
          ))}
        </nav>

        <div className={s.end}>
          <WalletButton variant="quiet" className="btn-sm" />
        </div>

        <button
          ref={toggle}
          type="button"
          className={s.toggle}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="site-menu"
        >
          <span aria-hidden className={s.toggleLabel} data-state={open ? "close" : "menu"}>
            <span>menu</span>
            <span>close</span>
          </span>
          <span className="sr-only">{open ? "close menu" : "open menu"}</span>
        </button>
      </div>

      {/* the mobile menu: a drinks card, not a drawer */}
      <div id="site-menu" className={s.menu} data-open={open} inert={!open}>
        <div className={s.menuCard}>
          <p className={s.menuKicker}>served all night</p>
          <ul className={s.menuList}>
            {NAV_ITEMS.map((i, n) => (
              <li key={i.href} style={{ "--i": n } as React.CSSProperties}>
                <Link
                  ref={n === 0 ? firstLink : undefined}
                  href={i.href}
                  className={s.menuItem}
                  aria-current={isActive(path, i.match) ? "page" : undefined}
                >
                  <span className={s.menuName}>{i.label}</span>
                  <span className={s.menuLeader} aria-hidden />
                  <span className={s.menuNote}>{i.note}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className={s.menuWallet}>
            <WalletButton className="w-full" />
          </div>
          <p className={s.menuSmall}>
            <a href={LINKS.x} target="_blank" rel="noreferrer" className="link">@monadsimpcult</a>
            <a href={LINKS.opensea} target="_blank" rel="noreferrer" className="link">the collection</a>
          </p>
        </div>
      </div>
    </header>
  );
}
