import type { Metadata } from "next";
import { DaoHome } from "./DaoHome";
import archive from "../../../data/archive-proposals.json";

export const metadata: Metadata = { title: "dao" };

export type ArchivedProposal = {
  id: string;
  title: string;
  description: string;
  date: string;
  source: string;
  link?: string;
  options: { label: string; votes: number }[];
  result: string;
};

export default function DaoPage() {
  return <DaoHome archive={archive as ArchivedProposal[]} />;
}
