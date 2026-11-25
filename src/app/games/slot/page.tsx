import type { Metadata } from "next";
import Link from "next/link";
import { SlotGame } from "@/games/slot/ui/SlotGame";

export const metadata: Metadata = {
  title: "simp machine",
  description: "three reels of Monad mascots, founders and SIMP wilds. spin with SIMP Points; every result can be checked.",
};

export default function SlotPage() {
  return (
    // tighter top padding than .page's default so the whole cabinet fits a phone screen
    <section className="page max-w-6xl pt-[84px] sm:pt-[124px]">
      <nav className="mb-3 text-[13.5px] sm:mb-4" aria-label="breadcrumb">
        <Link href="/games" className="link">
          all games
        </Link>
      </nav>
      <h1 className="sr-only">simp machine</h1>
      <SlotGame />
    </section>
  );
}
