import type { Metadata } from "next";
import Link from "next/link";
import { SlotGame } from "@/games/slot/ui/SlotGame";

export const metadata: Metadata = {
  title: "simp machine",
  description: "three reels of Monad mascots, simp faces and SIMP wilds. spin with SIMP Points; every result can be checked.",
};

export default function SlotPage() {
  return (
    <section className="relative w-full">
      <h1 className="sr-only">simp machine</h1>
      <nav className="absolute left-[var(--gutter)] top-[88px] z-20 text-[13px] sm:top-[104px]" aria-label="breadcrumb">
        <Link href="/games" className="link">
          all games
        </Link>
      </nav>
      <SlotGame />
    </section>
  );
}
