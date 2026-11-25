"use client";

import type { RecentSpin, SpinResponse } from "../types";
import { Chevron } from "./Paytable";
import styles from "./slot.module.css";

export type Verification = "none" | "checking" | "ok" | "fail";

type Props = {
  hash: string | null;
  clientSeed: string;
  seedValid: boolean;
  onSeedChange: (s: string) => void;
  onNewSeed: () => void;
  lastSpin: SpinResponse | null;
  verification: Verification;
  recent: RecentSpin[];
  disabled: boolean;
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function Fairness({ hash, clientSeed, seedValid, onSeedChange, onNewSeed, lastSpin, verification, recent, disabled }: Props) {
  return (
    <details className={styles.panel}>
      <summary>
        <span>check every spin</span>
        <Chevron />
      </summary>
      <div className={styles.panelBody}>
        <p className="mb-4 text-[13px] leading-relaxed text-dim">
          before you spin, the machine locks in a secret server seed and shows you its fingerprint (a sha-256 hash). your
          spin mixes that seed with a fresh seed from your browser, picked after the lock. afterwards the secret is
          revealed, and your browser re-runs the spin to confirm nothing changed.
        </p>

        <div className={styles.kv}>
          <span className={styles.kvLabel}>next spin is locked to (server seed hash)</span>
          <span className={styles.hash}>{hash ?? "preparing…"}</span>
        </div>

        <div className={styles.kv}>
          <label className={styles.kvLabel} htmlFor="slot-client-seed">
            your seed for the next spin (new every spin; type your own if you like)
          </label>
          <div className={styles.seedRow}>
            <input
              id="slot-client-seed"
              className={styles.seedInput}
              value={clientSeed}
              onChange={(e) => onSeedChange(e.target.value.trim().slice(0, 64))}
              aria-invalid={!seedValid}
              spellCheck={false}
              autoComplete="off"
              disabled={disabled}
            />
            <button type="button" className="btn btn-ghost" onClick={onNewSeed} disabled={disabled}>
              new seed
            </button>
          </div>
        </div>

        {lastSpin && (
          <div className={styles.kv}>
            <span className={styles.kvLabel}>last spin</span>
            <span className={styles.verified} style={{ color: verification === "fail" ? "var(--bad)" : verification === "ok" ? "var(--ok)" : "var(--text-2)" }}>
              {verification === "ok" && "verified in your browser: hash matches, result matches"}
              {verification === "checking" && "checking…"}
              {verification === "fail" && "this spin did not verify. report the spin id below to the team."}
            </span>
            <span className={styles.hash}>
              server seed {lastSpin.serverSeed}
              <br />
              hash {lastSpin.serverSeedHash}
              <br />
              your seed {lastSpin.clientSeed} · reel stops {lastSpin.stops.join(", ")}
              <br />
              spin {lastSpin.spinId}
            </span>
          </div>
        )}

        {recent.length > 0 && (
          <div className={styles.kv}>
            <span className={styles.kvLabel}>recent spins</span>
            <ul className={styles.recent}>
              {recent.slice(0, 6).map((s) => (
                <li key={s.spinId}>
                  <span>
                    {fmt(s.bet)} in, {s.totalWin > 0 ? <span className="text-ok">{fmt(s.totalWin)} back</span> : "0 back"}
                  </span>
                  <span className="text-mute">{new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-2 text-[12px] leading-relaxed text-mute">
          the maths: HMAC-SHA256(server seed, &quot;simp-machine:v1:&quot; + your seed). byte n, mod 64, is the stop on reel
          n. the reel strips, the paytable and the million-spin check live in the site code under src/games/slot.
        </p>
      </div>
    </details>
  );
}
