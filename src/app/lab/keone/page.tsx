import { notFound } from "next/navigation";
import { KeoneLab } from "./KeoneLab";

/** Dev-only playground for the Keone character. 404 in production builds. */
export default function KeoneLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <KeoneLab />;
}
