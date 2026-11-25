/**
 * Art slots on the home page.
 *
 * To change a slot: drop the file under /public and set `src` to its public
 * URL. Set `src` to null and the slot renders a marked "art drop soon"
 * placeholder, so the layout never breaks while art is missing.
 *
 * Sources (keep the licence notes there up to date):
 *   lore  -> research/nft-art/concepts/ ("The Devoted" art direction)
 *   nft   -> research/nft-art/current/images/ (the live collection, resized)
 */
export type ArtSlot = {
  id: string;
  /** public URL once the file exists, or null for a placeholder */
  src: string | null;
  alt: string;
  /** where the file lives (or should go), shown on the placeholder in dev */
  file: string;
};

export const LORE_SLOTS: ArtSlot[] = [
  { id: "lore-1", src: "/media/lore/devoted-137-zealot.svg", alt: "the zealot: a hooded simp with heart eyes, holding a rose under a pink neon arch", file: "public/media/lore/devoted-137-zealot.svg" },
  { id: "lore-2", src: "/media/lore/devoted-001-initiate.svg", alt: "the initiate: a hooded simp with closed eyes, holding a candle", file: "public/media/lore/devoted-001-initiate.svg" },
  { id: "lore-3", src: "/media/lore/devoted-250-high-simp.svg", alt: "the high simp: a glowing simp with a golden halo, holding a love letter", file: "public/media/lore/devoted-250-high-simp.svg" },
];

const NFT_IDS = [1, 81, 137, 300, 390, 421];

export const NFT_SLOTS: ArtSlot[] = NFT_IDS.map((n) => ({
  id: `nft-${n}`,
  src: `/media/nft/simp-${n}.webp`,
  alt: `simp cult #${n}`,
  file: `public/media/nft/simp-${n}.webp`,
}));
