"use client";

import { useEffect, useState } from "react";
import { SYMBOL_IDS, SYMBOL_META, type SymbolId } from "../config";

/**
 * Symbol art comes from public/games/slot/symbols/manifest.json, so new images
 * can be dropped in without touching code. Any id missing from the manifest
 * falls back to `<id>.svg` and the default name in config.
 */

export const SYMBOL_BASE = "/games/slot/symbols/";

export type SymbolArt = { src: string; label: string; alt: string; credit?: string };
export type SymbolArtMap = Record<SymbolId, SymbolArt>;

type ManifestEntry = { src?: string; label?: string; alt?: string; credit?: string };
type Manifest = { version?: number; symbols?: Partial<Record<string, ManifestEntry>> };

/** Only plain relative file names (or absolute same-origin paths) are accepted. */
const SAFE_SRC = /^(?:\/[\w\-./]+|[\w\-.]+(?:\/[\w\-.]+)*)\.(?:svg|png|webp|avif|jpe?g|gif)$/i;

/** Mascots and the Monad mark only ship as the committed image tiles (no drawn stand-ins). */
const DEFAULT_FILE: Partial<Record<SymbolId, string>> = {
  chog: "mascot-chog.png",
  molandak: "mascot-molandak.png",
  moyaki: "mascot-moyaki.png",
  monad: "logo-monad-logomark.png",
};

export function defaultArt(): SymbolArtMap {
  const out = {} as SymbolArtMap;
  for (const id of SYMBOL_IDS) {
    const name = SYMBOL_META[id].name;
    out[id] = { src: `${SYMBOL_BASE}${DEFAULT_FILE[id] ?? `${id}.svg`}`, label: name, alt: name };
  }
  return out;
}

export function mergeManifest(m: Manifest): SymbolArtMap {
  const out = defaultArt();
  for (const id of SYMBOL_IDS) {
    const e = m.symbols?.[id];
    if (!e) continue;
    const src = typeof e.src === "string" && SAFE_SRC.test(e.src) && !e.src.includes("..") ? e.src : null;
    out[id] = {
      src: src ? (src.startsWith("/") ? src : `${SYMBOL_BASE}${src}`) : out[id].src,
      label: typeof e.label === "string" && e.label.trim() ? e.label.trim().slice(0, 40) : out[id].label,
      alt: typeof e.alt === "string" && e.alt.trim() ? e.alt.trim().slice(0, 120) : out[id].alt,
      credit: typeof e.credit === "string" ? e.credit.slice(0, 200) : undefined,
    };
  }
  return out;
}

/** Unique art credits from the manifest, in symbol order. */
export function artCredits(art: SymbolArtMap): string[] {
  const out: string[] = [];
  for (const id of SYMBOL_IDS) {
    const c = art[id].credit?.trim();
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** `ready` flips once the manifest has loaded (or failed), so the reels never flash fallback art. */
export function useSymbolArt(): { art: SymbolArtMap; ready: boolean } {
  const [state, setState] = useState<{ art: SymbolArtMap; ready: boolean }>(() => ({ art: defaultArt(), ready: false }));
  useEffect(() => {
    let alive = true;
    fetch(`${SYMBOL_BASE}manifest.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
      .then((m) => {
        if (!alive) return;
        const art = m ? mergeManifest(m) : defaultArt();
        // decode everything up front so reels never pop in mid-spin
        const loads = SYMBOL_IDS.map((id) => {
          const img = new Image();
          img.decoding = "async";
          img.src = art[id].src;
          return img.decode().catch(() => undefined);
        });
        const show = () => alive && setState({ art, ready: true });
        void Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 2500))]).then(show);
      })
      .catch(() => alive && setState((s) => ({ ...s, ready: true })));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
