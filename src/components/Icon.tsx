type Name =
  | "opensea"
  | "x"
  | "menu"
  | "close"
  | "wallet"
  | "shield"
  | "check"
  | "warn"
  | "external"
  | "telegram"
  | "copy"
  | "spinner";

/** Tiny inline icon set (generic shapes, no brand marks). */
export function Icon({ name, className = "h-4 w-4" }: { name: Name; className?: string }) {
  const p = {
    className,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  };
  switch (name) {
    case "opensea": // generic "sail / marketplace" glyph
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M7 14h10l-2 3H9z" />
          <path d="M12 6v8M12 6c-2 2-3 4-3 8" />
        </svg>
      );
    case "x":
      return (
        <svg {...p}>
          <path d="M4 4l16 16M20 4L4 20" />
        </svg>
      );
    case "menu":
      return (
        <svg {...p}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case "close":
      return (
        <svg {...p}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...p}>
          <rect x="3" y="6" width="18" height="13" rx="3" />
          <path d="M3 10h18M16 14h2" />
        </svg>
      );
    case "shield":
      return (
        <svg {...p}>
          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "check":
      return (
        <svg {...p}>
          <path d="M5 13l4 4L19 7" />
        </svg>
      );
    case "warn":
      return (
        <svg {...p}>
          <path d="M12 4l9 16H3z" />
          <path d="M12 10v4M12 17h.01" />
        </svg>
      );
    case "external":
      return (
        <svg {...p}>
          <path d="M14 4h6v6M20 4l-9 9" />
          <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
        </svg>
      );
    case "telegram":
      return (
        <svg {...p}>
          <path d="M21 4L3 11l6 2 2 6 3-4 5 3z" />
          <path d="M9 13l10-8" />
        </svg>
      );
    case "copy":
      return (
        <svg {...p}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 0 1 2-2h9" />
        </svg>
      );
    case "spinner":
      return (
        <svg {...p} className={`${className} animate-spin`}>
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
      );
  }
}
