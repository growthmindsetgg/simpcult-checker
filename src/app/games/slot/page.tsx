import type { Metadata } from "next";
import Link from "next/link";
import { SlotGame } from "@/games/slot/ui/SlotGame";

export const metadata: Metadata = {
  title: "the machine",
  description: "three reels of Monad mascots, simp faces and SIMP wilds. spin with SIMP Points; every result can be checked.",
};

export default function SlotPage() {
  return (
    <section className="relative w-full">
      {/* a real, visible h1. desktop: the one h1 token, top-left on empty wall. phones: the cabinet
          fills the frame, so the title shrinks to a glass placard instead of covering the lit sign */}
      <header className="pointer-events-none absolute left-[max(var(--gutter),env(safe-area-inset-left))] top-[76px] z-20 grid justify-items-start gap-1 rounded-[10px] border border-[rgba(217,168,69,0.3)] bg-[rgba(33,15,48,0.78)] px-3.5 py-2.5 backdrop-blur-[10px] sm:top-[96px] sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none [&_a]:pointer-events-auto">
        <nav aria-label="breadcrumb" className="text-[13px]">
          <Link href="/games" className="link">
            All games
          </Link>
        </nav>
        <h1 className="t-h1 max-sm:!text-[22px] max-sm:!italic max-sm:!tracking-[-0.02em] sm:[text-shadow:0_2px_18px_rgb(14_9_28/0.85)]">
          The machine
        </h1>
      </header>
      <SlotGame />
    </section>
  );
}
