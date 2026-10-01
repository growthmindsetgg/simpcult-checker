import { monad } from "viem/chains";
import type { Address } from "viem";

/**
 * Single source of truth for addresses & links.
 * Everything here is PUBLIC (NEXT_PUBLIC_*). Secrets live only in server code.
 */
export const CHAIN = monad; // id 143, MON
export const CHAIN_ID = monad.id;

export const RPC_URL =
  process.env.NEXT_PUBLIC_MONAD_RPC ?? "https://rpc.monad.xyz";

/** Monad Simp Cult NFT (ERC-721) — confirm before mainnet use. */
export const NFT_ADDRESS = (process.env.NEXT_PUBLIC_NFT_ADDRESS ??
  "0xd8830709f8527033e03f44217ad093624997e60f") as Address;

/** SimpDAO governor (set after `forge script` deploy). */
export const DAO_ADDRESS = (process.env.NEXT_PUBLIC_DAO_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;

export const DAO_DEPLOYED =
  DAO_ADDRESS !== "0x0000000000000000000000000000000000000000";

export const SITE = {
  name: "simp cult",
  domain: process.env.NEXT_PUBLIC_SITE_DOMAIN ?? "simpcult.xyz",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://simpcult.xyz",
  description:
    "simping for what truly matters, until you actually get it. the simp cult nft collection on monad.",
};

export const LINKS = {
  x: "https://x.com/monadsimpcult",
  opensea: "https://opensea.io/collection/monad-simp-cult",
  github: "https://github.com/growthmindsetgg/simpcult-checker",
  telegramBot: process.env.NEXT_PUBLIC_TELEGRAM_BOT
    ? `https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT}`
    : "",
  explorer: "https://monadvision.com",
  pocketUniverse: "https://www.pocketuniverse.app/",
};

export const TEAM = [
  { role: "founder", handle: "cryptodurgesh" },
  { role: "co-founder", handle: "jani_shanu" },
  { role: "simp artist", handle: "lambe1981" },
  { role: "hr & commander", handle: "DexDev33" },
];

export const explorerAddress = (a: string) => `${LINKS.explorer}/address/${a}`;
export const explorerTx = (h: string) => `${LINKS.explorer}/tx/${h}`;
export const short = (a?: string) =>
  a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
