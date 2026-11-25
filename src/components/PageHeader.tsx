import type { ReactNode } from "react";

/** shared title block for inner pages (/join, /dao; free for /portal, /games) */
export function PageHeader({
  eyebrow,
  title,
  lead,
  aside,
}: {
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="rise flex flex-wrap items-end justify-between gap-6">
      <div className="page-head max-w-2xl">
        {eyebrow && <p className="t-eyebrow">{eyebrow}</p>}
        <h1 className="t-h1">{title}</h1>
        {lead && <p className="t-lead">{lead}</p>}
      </div>
      {aside && <div className="flex items-center gap-2 pb-1">{aside}</div>}
    </header>
  );
}
