import type { Metadata } from "next";
import { VerifyFlow } from "./VerifyFlow";
import { Reveal } from "@/components/motion";

export const metadata: Metadata = { title: "holder verification" };

export default function VerifyPage() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 pb-32 pt-36">
      <Reveal>
      <p className="t-eyebrow mb-4">holders only</p>
      <h1 className="t-h1 text-[clamp(34px,5vw,52px)]">get into the cult chat</h1>
      <p className="t-lead mt-5">
        the telegram group is for simp cult nft holders only. prove you hold one, get a single-use invite. sell your
        simp and the bot removes you automatically — re-verify whenever you&apos;re back.
      </p>
      </Reveal>
      <VerifyFlow />
    </section>
  );
}
