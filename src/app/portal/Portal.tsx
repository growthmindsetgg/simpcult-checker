"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/useSession";
import { useMounted } from "@/lib/useMounted";
import { seasonAt } from "@/lib/points/config";
import { api, isWarming, retryPolicy, type Me, type SeasonInfo } from "./lib";
import { FIXTURES_ENABLED, FIXTURE_NAMES, fixtureSession, useFixture } from "./fixtures";
import {
  Board,
  CheckinTicket,
  Jammed,
  Mast,
  Paytable,
  Plaque,
  Printing,
  ReceiptRoll,
  SeasonMachine,
  SlipDesk,
  WarmingUp,
} from "./parts";
import s from "./portal.module.css";

/**
 * The points desk. Which view shows:
 *   loading   → a ticket being printed
 *   warming   → the API says storage / sign-in isn't configured (503)
 *   signedout → no wallet: a void ticket + "connect wallet"
 *   signin    → wallet, no session: "sign in (free)"
 *   jammed    → /me failed
 *   desk      → the real thing (non-holders get a "members only" stamp)
 * The one neon button is the ticket's until it's punched, then the slip's.
 */
export function Portal() {
  const mounted = useMounted();
  const fx = useFixture();
  const wallet = useAccount();
  const real = useSession();
  const fs = fx ? fixtureSession(fx) : null;

  const connected = fs ? fs.connected : wallet.isConnected;
  const address = fs ? (fs.signedIn ? fs.address : null) : (real.session?.address ?? null);
  const sessionLoading = fs ? false : real.isLoading;

  const season = useQuery({
    queryKey: ["points", "season", fx],
    queryFn: () => api<SeasonInfo>("/api/points/season"),
    refetchInterval: 60_000,
    retry: retryPolicy,
  });
  const seasonWarming = isWarming(season.error);
  const me = useQuery({
    queryKey: ["points", "me", fx],
    queryFn: () => api<Me>("/api/points/me"),
    enabled: mounted && !!address && !seasonWarming,
    staleTime: 10_000,
    retry: retryPolicy,
  });
  const warming = seasonWarming || isWarming(me.error);

  const view: "loading" | "warming" | "signedout" | "signin" | "jammed" | "desk" =
    !mounted || season.isLoading || sessionLoading
      ? "loading"
      : warming
        ? "warming"
        : !connected
          ? "signedout"
          : !address
            ? "signin"
            : me.isLoading
              ? "loading"
              : me.error || !me.data
                ? "jammed"
                : "desk";

  const n = season.data?.season ?? Math.max(1, seasonAt());
  const live = season.data ? season.data.live : seasonAt() >= 1;
  const m = view === "desk" ? me.data : undefined;
  const eligible = !!m && (m.holder || m.monadCard.holder);
  const ticketVariant = !live ? "closed" : m && !m.holder ? "members" : "live";
  const slipHot = !!m && (!m.holder || !live || m.checkin.checkedInToday);

  return (
    <div className={s.desk}>
      {FIXTURES_ENABLED && <DevFixtures current={fx} />}
      <Mast info={season.data} />

      {view === "loading" && <Printing label={mounted ? "printing your ticket" : "warming the printer"} />}
      {view === "warming" && <WarmingUp />}
      {(view === "signedout" || view === "signin") && (
        <div className={s.rowA}>
          <Plaque />
          <CheckinTicket variant={!live ? "closed" : view} season={n} />
        </div>
      )}
      {view === "jammed" && (
        <Jammed message={(me.error as Error)?.message ?? "try again in a moment"} onRetry={() => me.refetch()} />
      )}
      {view === "desk" && m && (
        <>
          <div className={s.rowA}>
            <Plaque me={m} />
            <CheckinTicket variant={ticketVariant} me={m} season={n} />
          </div>
          <div className={s.rowB}>
            <SlipDesk me={m} hot={slipHot && eligible} />
            <ReceiptRoll me={m} />
          </div>
        </>
      )}

      <div className={s.rowC}>
        <SeasonMachine info={season.data} warming={warming} />
        <Board me={address} myRank={m?.rank} warming={warming} />
      </div>

      <Paytable />

      {m?.admin && (
        <div>
          <Link className={s.brass} href={`/portal/admin${fx ? `?fixture=${fx}` : ""}`}>
            admin queue →
          </Link>
        </div>
      )}
    </div>
  );
}

function DevFixtures({ current }: { current: string | null }) {
  return (
    <nav className={s.devbar} aria-label="dev fixtures">
      <span>dev fixtures:</span>
      <a href="?" aria-current={!current}>
        live
      </a>
      {FIXTURE_NAMES.map((f) => (
        <a key={f} href={`?fixture=${f}`} aria-current={current === f}>
          {f}
        </a>
      ))}
    </nav>
  );
}
