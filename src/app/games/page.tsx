import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { GAMES } from "@/games/registry";

export const metadata: Metadata = {
  title: "games",
  description: "put your SIMP Points to work in cult games. first up: the simp machine.",
};

const fmt = (n: number) => n.toLocaleString("en-US");

export default function GamesHub() {
  return (
    <section className="page max-w-5xl">
      <PageHeader
        title="games"
        lead="your SIMP Points, put to work. every game is settled on the server, and every result can be checked."
      />

      <ul className="mt-10 grid gap-5 md:grid-cols-2">
        {GAMES.map((g) =>
          g.status === "live" ? (
            <li key={g.id}>
              <Link href={g.route} className="glass glass-hover flex h-full flex-col p-6 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <span className="pill pill-ok">live</span>
                  <span className="num text-[13px] text-mute">
                    {fmt(g.minBet)} to {fmt(g.maxBet)} points per {g.playUnit ?? "play"}
                  </span>
                </div>

                {g.preview && g.preview.length > 0 && (
                  <div className="mt-6 grid grid-cols-3 gap-2 rounded-[18px] bg-[#07020a] p-2 shadow-[inset_0_2px_12px_rgba(0,0,0,0.8),inset_0_0_0_1px_rgba(255,175,225,0.08)]">
                    {g.preview.slice(0, 3).map((src) => (
                      <div
                        key={src}
                        className="grid aspect-square place-items-center rounded-xl bg-[linear-gradient(180deg,#e6cfe0,#fff_50%,#e6cfe0)]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- symbol art, any format */}
                        <img src={src} alt="" className="h-[82%] w-[82%] object-contain" />
                      </div>
                    ))}
                  </div>
                )}

                <h2 className="t-wide mt-7 text-[20px] sm:text-[24px]">{g.name}</h2>
                <p className="t-body mt-3">{g.tagline}</p>
                <span className="btn btn-primary mt-6 self-start">play {g.name.toLowerCase()}</span>
              </Link>
            </li>
          ) : (
            <li key={g.id}>
              <div className="flex h-full flex-col rounded-[var(--r-lg)] border border-dashed border-line-strong p-6 sm:p-7">
                <span className="pill self-start">coming soon</span>
                <h2 className="t-wide mt-7 text-[20px] text-dim sm:text-[24px]">{g.name}</h2>
                <p className="t-body mt-3">{g.tagline}</p>
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
