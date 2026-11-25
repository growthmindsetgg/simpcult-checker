import type { Metadata } from "next";
import { JoinFlow } from "./JoinFlow";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "join the holders' chat" };

export default function JoinPage() {
  return (
    <section className="page max-w-3xl">
      <PageHeader
        eyebrow="holders only"
        title="join the holders' chat"
        lead={
          <>
            the telegram group is for simp cult nft holders. prove you hold one and get a single-use invite. sell your simp and
            the bot shows you out. verify again whenever you&apos;re back.
          </>
        }
      />
      <JoinFlow />
    </section>
  );
}
