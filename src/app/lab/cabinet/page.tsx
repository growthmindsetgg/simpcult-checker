import { notFound } from "next/navigation";
import { CabinetLab } from "./CabinetLab";

/** Dev-only playground for the 3D slot cabinet. 404 in production builds. */
export default function CabinetLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CabinetLab />;
}
