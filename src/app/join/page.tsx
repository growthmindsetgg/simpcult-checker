import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinFlow } from "./JoinFlow";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "join",
  description: "verify your wallet to earn simp points. sign with a connected wallet, or send a 0-MON transaction to yourself.",
};

export default function JoinPage() {
  return (
    <section className="page max-w-3xl">
      <PageHeader
        eyebrow="Verify your wallet"
        title="Join the cult"
        lead={
          <>
            Prove a wallet is yours to start earning points. Sign a message with a connected wallet, or send a 0-MON
            transaction to yourself from any wallet app. Telegram is optional: it gets you 3x points.
          </>
        }
      />
      {/* the flow reads ?via= from the URL, so it renders on the client */}
      <Suspense fallback={<div className="mt-12 h-64" aria-hidden />}>
        <JoinFlow />
      </Suspense>
    </section>
  );
}
