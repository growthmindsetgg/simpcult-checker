import type { Metadata } from "next";
import { AdminQueue } from "./AdminQueue";

export const metadata: Metadata = { title: "points admin", robots: { index: false } };

export default function AdminPage() {
  return (
    <section className="page max-w-6xl">
      <AdminQueue />
    </section>
  );
}
