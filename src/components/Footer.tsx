import Link from "next/link";
import { LINKS, TEAM, NFT_ADDRESS, explorerAddress, short } from "@/lib/config";
import s from "./chrome.module.css";

const HOUSE = [
  { href: "/games/slot", label: "the machine" },
  { href: "/portal", label: "earn points" },
  { href: "/dao", label: "simp dao" },
  { href: "/join", label: "holders' chat" },
];

export function Footer() {
  return (
    <footer className={s.footer}>
      <div className={`shell ${s.footInner}`}>
        <p className={s.motto}>simping for what truly matters, until you actually get it.</p>

        <div className={s.footCols}>
          <nav aria-label="footer">
            <h2>the house</h2>
            <ul>
              {HOUSE.map((m) => (
                <li key={m.href}><Link href={m.href}>{m.label}</Link></li>
              ))}
            </ul>
          </nav>
          <div>
            <h2>elsewhere</h2>
            <ul>
              <li><a href={LINKS.x} target="_blank" rel="noreferrer">@monadsimpcult</a></li>
              <li><a href={LINKS.opensea} target="_blank" rel="noreferrer">opensea</a></li>
              <li><a href={LINKS.github} target="_blank" rel="noreferrer">source code</a></li>
            </ul>
          </div>
          <div className={s.crew}>
            <h2>the cult</h2>
            <ul>
              {TEAM.map((t) => (
                <li key={t.handle}>
                  <a href={`https://x.com/${t.handle}`} target="_blank" rel="noreferrer">@{t.handle}</a> <span>{t.role}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className={`shell ${s.fine}`}>
        <div>
          <p>fan-made. not affiliated with Monad or the Monad Foundation.</p>
          <p>
            Monad logo © Monad Foundation, CC BY 4.0. Chog, Molandak and Moyaki are Monad community characters.
          </p>
        </div>
        <a className={`link ${s.contract}`} href={explorerAddress(NFT_ADDRESS)} target="_blank" rel="noreferrer">
          collection {short(NFT_ADDRESS)}
        </a>
      </div>
    </footer>
  );
}
