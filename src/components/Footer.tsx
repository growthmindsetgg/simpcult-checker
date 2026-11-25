import Link from "next/link";
import { LINKS, TEAM, NFT_ADDRESS, explorerAddress, short } from "@/lib/config";
import { Logo } from "./Logo";

const MACHINE = [
  { href: "/portal", label: "portal" },
  { href: "/games", label: "games" },
  { href: "/join", label: "holders' chat" },
  { href: "/dao", label: "dao" },
];

export function Footer() {
  return (
    <footer className="relative z-10 mt-auto border-t border-line bg-bg/80 backdrop-blur-xl">
      <div className="shell grid grid-cols-2 gap-x-6 gap-y-10 py-16 text-[14px] text-dim md:grid-cols-[1.4fr_1fr_1fr_1.2fr] md:gap-8">
        <div className="col-span-2 md:col-span-1">
          <Link href="/" className="inline-flex items-center gap-2.5" aria-label="simp machine, home">
            <Logo className="h-8 w-8" />
            <span className="font-wide text-[12px] uppercase tracking-[0.16em] text-simp-50">simp machine</span>
          </Link>
          <p className="mt-4 max-w-[30ch] leading-relaxed">
            simping for what matters, until you get it. a simp cult production on monad.
          </p>
          <p className="mono mt-4 text-mute">
            nft{" "}
            <a className="link" href={explorerAddress(NFT_ADDRESS)} target="_blank" rel="noreferrer">
              {short(NFT_ADDRESS)}
            </a>
          </p>
        </div>

        <nav aria-label="footer">
          <h2 className="mb-3 text-[13px] font-semibold text-text">the machine</h2>
          <ul className="space-y-2.5">
            {MACHINE.map((m) => (
              <li key={m.href}><Link className="link" href={m.href}>{m.label}</Link></li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="mb-3 text-[13px] font-semibold text-text">elsewhere</h2>
          <ul className="space-y-2.5">
            <li><a className="link" href={LINKS.x} target="_blank" rel="noreferrer">@monadsimpcult</a></li>
            <li><a className="link" href={LINKS.opensea} target="_blank" rel="noreferrer">opensea</a></li>
            <li><a className="link" href={LINKS.github} target="_blank" rel="noreferrer">github</a></li>
          </ul>
        </div>

        <div className="col-span-2 md:col-span-1">
          <h2 className="mb-3 text-[13px] font-semibold text-text">the cult</h2>
          <ul className="space-y-2.5">
            {TEAM.map((t) => (
              <li key={t.handle} className="flex flex-wrap gap-x-1.5">
                <a className="link" href={`https://x.com/${t.handle}`} target="_blank" rel="noreferrer">@{t.handle}</a>
                <span className="text-mute">{t.role}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
