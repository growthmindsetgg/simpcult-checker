import type { Metadata } from "next";
import { Portal } from "./Portal";

export const metadata: Metadata = {
  title: "SIMP Points",
  description: "check in, post, bring alpha — stack SIMP Points every season.",
};

export default function PortalPage() {
  return (
    <section className="page max-w-6xl">
      <Portal />
    </section>
  );
}
