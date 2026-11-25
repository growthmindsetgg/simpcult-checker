"use client";

import { HOUSE_EDGE, LINE_RULES, LINES, SCATTER_PAYS, TARGET_RTP, type SymbolId } from "../config";
import type { SymbolArtMap } from "./symbols";
import styles from "./slot.module.css";

const fmt = (n: number) => n.toLocaleString("en-US");

export function Paytable({ art, bet }: { art: SymbolArtMap; bet: number }) {
  const lineBet = bet / LINES;
  const icons = (ids: readonly SymbolId[]) => (ids.length === 1 ? [ids[0], ids[0], ids[0]] : ids);
  return (
    <details className={styles.panel} open>
      <summary>
        <span>paytable</span>
        <Chevron />
      </summary>
      <div className={styles.panelBody}>
        <p className="mb-3 text-[13px] leading-relaxed text-dim">
          five lines: three rows and both diagonals. your points split evenly across them, and each line pays its best
          match. <strong className="text-text">{art.wild.label}</strong> stands in for anything except the{" "}
          {art.scatter.label.toLowerCase()}.
        </p>
        <ul>
          {LINE_RULES.map((rule) => (
            <li key={rule.id} className={styles.payRow}>
              <span className={styles.paySyms} aria-hidden>
                {icons(rule.members).map((id, i) => (
                  // eslint-disable-next-line @next/next/no-img-element -- manifest art
                  <img key={i} src={art[id].src} alt="" />
                ))}
              </span>
              <span className={styles.payLabel}>{labelFor(rule.id, rule.label, art)}</span>
              <span className={styles.payAmt}>
                {fmt(rule.pays * lineBet)}
                <span>{rule.pays}× line</span>
              </span>
            </li>
          ))}
          {SCATTER_PAYS.map((p, count) =>
            p > 0 ? (
              <li key={`s${count}`} className={styles.payRow}>
                <span className={styles.paySyms} aria-hidden>
                  {Array.from({ length: count }, (_, i) => (
                    // eslint-disable-next-line @next/next/no-img-element -- manifest art
                    <img key={i} src={art.scatter.src} alt="" />
                  ))}
                </span>
                <span className={styles.payLabel}>
                  {count} {art.scatter.label.toLowerCase()}s, anywhere
                </span>
                <span className={styles.payAmt}>
                  {fmt(p * bet)}
                  <span>{p}× spin</span>
                </span>
              </li>
            ) : null,
          )}
        </ul>
        <p className="mt-3 text-[12.5px] leading-relaxed text-mute">
          amounts are for {fmt(bet)} points per spin. over many spins the machine gives back{" "}
          {(TARGET_RTP * 100).toFixed(1)}% of the points played and keeps {(HOUSE_EDGE * 100).toFixed(1)}%. that number is
          set in the game config and checked against a million simulated spins.
        </p>
      </div>
    </details>
  );
}

function labelFor(id: string, fallback: string, art: SymbolArtMap): string {
  if (id in art) return `3 × ${art[id as SymbolId].label}`;
  return fallback.toLowerCase();
}

export function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
