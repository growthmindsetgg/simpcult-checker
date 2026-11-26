import { getBalance } from "@/lib/points";
import { MONAD_CARD_ENABLED } from "@/lib/points/config";
import { checkinStatus } from "@/lib/points/checkin";
import { monadCardBalance, nftBalance } from "@/lib/points/chain";
import { capsLeft, mySubmissions } from "@/lib/points/submissions";
import { myRank } from "@/lib/points/season";
import { getHandle } from "@/lib/points/xhandle";
import { handle, isAdminSession, ok, requireSession } from "@/lib/points/http";

export const dynamic = "force-dynamic";

/** everything the portal needs about the signed-in wallet, in one call */
export const GET = handle(async () => {
  const s = await requireSession();
  const a = s.address;
  const [balance, nfts, cards, checkin, x, caps, submissions, rank] = await Promise.all([
    getBalance(a),
    nftBalance(a).catch(() => 0),
    MONAD_CARD_ENABLED ? monadCardBalance(a).catch(() => 0) : Promise.resolve(0),
    checkinStatus(a),
    getHandle(a),
    capsLeft(a),
    mySubmissions(a, 20),
    myRank(a),
  ]);
  return ok({
    address: a,
    balance,
    holder: nfts > 0,
    nfts,
    monadCard: { enabled: MONAD_CARD_ENABLED, holder: cards > 0 },
    checkin,
    x: x ? { handle: x.handle, verified: x.verified, code: x.verified ? undefined : x.code } : null,
    caps,
    submissions,
    rank,
    admin: isAdminSession(s),
  });
});
