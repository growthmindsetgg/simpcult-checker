import { notFound } from "next/navigation";
import { LabClient } from "./LabClient";

/** Dev-only playground for the 3D stage. 404 in production builds. */
export default function CasinoLab() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LabClient />;
}
