/** simp machine mark: a neon heart in a lit slot window */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff6ac3" />
          <stop offset="1" stopColor="#e0238f" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="31" height="31" rx="10" fill="url(#logo-bg)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="10" fill="none" stroke="rgba(255,255,255,.35)" />
      <path
        d="M16 24s-7-4.3-8.6-8.6C6.2 12.3 8 9 11.2 9c2 0 3.4 1.1 4.8 2.8C17.4 10.1 18.8 9 20.8 9 24 9 25.8 12.3 24.6 15.4 23 19.7 16 24 16 24Z"
        fill="#1d0414"
      />
    </svg>
  );
}
