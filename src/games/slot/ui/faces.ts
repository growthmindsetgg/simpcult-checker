"use client";

import { useSyncExternalStore } from "react";
import type { SymbolId } from "../config";
import type { SymbolArtMap } from "./symbols";

/**
 * The face symbols. The symbol ids never change (founder-1/2/3 in config);
 * only what they show does:
 *   founder-1  "your face": the signed-in wallet's Simp Cult NFT, through the
 *              same-origin /api/face?id=<tokenId> route (WebGL needs
 *              CORS-clean pixels, and the metadata host can't be fetched
 *              from the browser under our CSP). Falls back to the manifest
 *              tile (a hand mirror) when signed out or holding no NFT.
 *   founder-2/3 "simps": committed holder art, set in the manifest.
 *
 * Shared by the DOM reels and the 3D cabinet as a tiny module store, because
 * the cabinet lives inside the R3F canvas and can't read React context.
 */

export const FACE_IDS: readonly SymbolId[] = ["founder-1", "founder-2", "founder-3"];
export const isFace = (id: SymbolId) => FACE_IDS.includes(id);

/** display label overrides for pay rules whose config label still says "founder" */
export const RULE_LABELS: Partial<Record<string, string>> = {
  "any-founder": "any 3 faces",
};

export type Faces = {
  /** same-origin image URL of the signed-in simp's NFT, or null for the fallback tile */
  you: string | null;
  /** token id behind `you`, for the label */
  youToken: number | null;
};

const EMPTY: Faces = { you: null, youToken: null };
let state: Faces = EMPTY;
let owner: string | null | undefined; // undefined: not asked yet
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

/** Tell the store whose face to show (the address the slot state came back with). */
export function setFaceOwner(address: string | null) {
  const a = address?.toLowerCase() ?? null;
  if (a === owner) return;
  owner = a;
  if (!a || !/^0x[0-9a-f]{40}$/.test(a)) {
    if (state !== EMPTY) {
      state = EMPTY;
      emit();
    }
    return;
  }
  void (async () => {
    try {
      const r = await fetch(`/api/dao/tokens?address=${a}`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return;
      const d = (await r.json()) as { tokenIds?: unknown };
      const ids = Array.isArray(d.tokenIds) ? d.tokenIds.filter((n): n is number => Number.isInteger(n) && n >= 0) : [];
      if (ids.length === 0 || owner !== a) return;
      const id = Math.min(...ids);
      const url = `/api/face?id=${id}`;
      // only switch once the pixels are really there, so no reel ever shows a broken face.
      // The IPFS gateways behind /api/face answer 429 now and then: a miss keeps the tile, and a slow
      // answer (each gateway gets 6 s server-side) still swaps the face in whenever it arrives.
      if (!(await decodes(url, FACE_WAIT_MS)) || owner !== a) return;
      state = { you: url, youToken: id };
      emit();
    } catch {
      /* keep the fallback tile */
    }
  })();
}

/** the reels show the tile meanwhile, so waiting long costs nothing; it only bounds a request that never ends */
const FACE_WAIT_MS = 30000;

/** true once `src` has loaded and decoded; false on error or after `ms`; never rejects */
function decodes(src: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => {
      img.src = "";
      resolve(false);
    }, ms);
    img.src = src;
    img.decode().then(
      () => (clearTimeout(t), resolve(true)),
      () => (clearTimeout(t), resolve(false)),
    );
  });
}

export function getFaces(): Faces {
  return state;
}

export function subscribeFaces(cb: () => void) {
  subs.add(cb);
  return () => void subs.delete(cb);
}

export function useFaces(): Faces {
  return useSyncExternalStore(subscribeFaces, getFaces, () => EMPTY);
}

/** symbol art with the live faces swapped in (labels stay from the manifest) */
const FACE_LABELS: Partial<Record<SymbolId, string>> = { "founder-1": "Your face", "founder-2": "Fellow simp", "founder-3": "Elder simp" };

export function applyFaces(input: SymbolArtMap, f: Faces): SymbolArtMap {
  // no manifest (fetch failed): never show the config's placeholder "Founder" names
  let art = input;
  for (const id of FACE_IDS) {
    if (/founder/i.test(art[id].label)) art = { ...art, [id]: { ...art[id], label: FACE_LABELS[id]!, alt: FACE_LABELS[id]! } };
  }
  if (!f.you) return art;
  return {
    ...art,
    "founder-1": {
      ...art["founder-1"],
      src: f.you,
      // if the face can't be fetched again when the atlas repaints, the manifest tile stands in
      fallback: art["founder-1"].src,
      alt: f.youToken !== null ? `your face: Simp Cult #${f.youToken}` : art["founder-1"].alt,
    },
  };
}
