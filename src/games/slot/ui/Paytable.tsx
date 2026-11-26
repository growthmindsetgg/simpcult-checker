"use client";

import { HOUSE_EDGE, LINE_RULES, LINES, SCATTER_PAYS, TARGET_RTP, type SymbolId } from "../config";
import type { SymbolArtMap } from "./symbols";
import { RULE_LABELS, isFace } from "./faces";
import styles from "./slot.module.css";

const fmt = (n: number) => n.toLocaleString("en-US");

/** The pay card: printed on cream stock, like the one taped inside a real cabinet. */
export function Paytable({ art, bet }: { art: SymbolArtMap; bet: number }) {
  const lineBet = bet / LINES;
  const icons = (ids: readonly SymbolId[]) => (ids.length === 1 ? [ids[0], ids[0], ids[0]] : ids);
  return (
    <div className={styles.payCard}>
      <div className={styles.payHead}>
        <span className={styles.payKicker}>pays on five lines</span>
        <span className={styles.payBet}>at {fmt(bet)} a spin</span>
      </div>
      <p className={styles.payIntro}>
        three rows and both diagonals. your points split evenly across them, and each line pays its best match.{" "}
        <strong>{art.wild.label}</strong> stands in for anything except the {art.scatter.label.toLowerCase()}.
      </p>
      <ul className={styles.payList}>
        {LINE_RULES.map((rule) => (
          <li key={rule.id} className={styles.payRow}>
            <span className={styles.paySyms} aria-hidden>
              {icons(rule.members).map((id, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- manifest art
                <img key={i} src={art[id].src} alt="" data-face={isFace(id) || undefined} />
              ))}
            </span>
            <span className={styles.payLabel}>{labelFor(rule.id, rule.label, art)}</span>
            <span className={styles.payLeader} aria-hidden />
            <span className={styles.payAmt}>
              {fmt(rule.pays * lineBet)}
              <small>{rule.pays}× line</small>
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
              <span className={styles.payLeader} aria-hidden />
              <span className={styles.payAmt}>
                {fmt(p * bet)}
                <small>{p}× spin</small>
              </span>
            </li>
          ) : null,
        )}
      </ul>
      <p className={styles.payFoot}>
        over many spins the machine gives back {(TARGET_RTP * 100).toFixed(1)}% of the points played and keeps{" "}
        {(HOUSE_EDGE * 100).toFixed(1)}%. that number is set in the game config and checked against a million simulated
        spins.
      </p>
      <p className={styles.payFoot}>
        <strong>{art["founder-1"].label}</strong> is your own Simp Cult NFT once you&apos;re signed in.{" "}
        {art["founder-2"].label.toLowerCase()} and {art["founder-3"].label.toLowerCase()} are fellow holders.
      </p>
    </div>
  );
}

function labelFor(id: string, fallback: string, art: SymbolArtMap): string {
  const override = RULE_LABELS[id];
  if (override) return override;
  if (id in art) return `3 × ${art[id as SymbolId].label}`;
  return fallback.toLowerCase();
}
