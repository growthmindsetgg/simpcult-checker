"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import s from "./chrome.module.css";

/** the closing call to check in, folded into the footer (hidden where you already are: the portal) */
export function FooterCall() {
  const path = usePathname();
  if (path.startsWith("/portal")) return null;
  return (
    <div className={s.footCall}>
      <p>Check in today and your streak starts today. Tomorrow it’s a day shorter.</p>
      <div className={s.footKeys}>
        <Link href="/portal" className="btn btn-primary">
          Say gsimp
        </Link>
        <Link href="/games/slot" className={s.footQuiet}>
          or pull the lever
        </Link>
      </div>
    </div>
  );
}
