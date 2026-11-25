/**
 * Game registry: every game on /games is one entry here.
 *
 * Add a game:
 *   1. Put its logic in `src/games/<id>/` (config, engine, server code).
 *   2. Put its page in `src/app/games/<id>/page.tsx` and any API under
 *      `src/app/api/games/<id>/`.
 *   3. Add an entry below with `status: "live"` (plus `preview` art and a
 *      `playUnit`). The /games hub renders it; no hub edits needed.
 *   Games only touch points through the Points API (getBalance/credit/debit).
 */
import { MAX_BET, MIN_BET } from "./slot/config";

export type GameStatus = "live" | "soon";

export type GameEntry = {
  id: string;
  name: string;
  /** page route; ignored while status is "soon" */
  route: string;
  status: GameStatus;
  /** points per play */
  minBet: number;
  maxBet: number;
  /** one line for the hub card */
  tagline: string;
  /** what one play is called on the hub card, e.g. "spin" */
  playUnit?: string;
  /** up to 3 images (public paths) shown on the hub card */
  preview?: string[];
};

export const GAMES: readonly GameEntry[] = [
  {
    id: "slot",
    name: "Simp Machine",
    route: "/games/slot",
    status: "live",
    minBet: MIN_BET,
    maxBet: MAX_BET,
    tagline: "three reels of Monad mascots, founders and SIMP wilds. line up three and your points multiply.",
    playUnit: "spin",
    preview: ["/games/slot/symbols/mascot-chog.png", "/games/slot/symbols/wild.svg", "/games/slot/symbols/logo-monad-logomark.png"],
  },
  {
    id: "next",
    name: "Next game",
    route: "/games",
    status: "soon",
    minBet: 0,
    maxBet: 0,
    tagline: "something new is being built for the cult. bring your points.",
  },
];

export const liveGames = () => GAMES.filter((g) => g.status === "live");
export const getGame = (id: string) => GAMES.find((g) => g.id === id);
