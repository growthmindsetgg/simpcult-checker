import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProposalView } from "./ProposalView";

export const metadata: Metadata = { title: "proposal" };

export default async function ProposalPage({ params }: PageProps<"/dao/[id]">) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n < 0) notFound();
  return <ProposalView id={n} />;
}
