/**
 * The wordmark: Bodoni, lowercase, with one small lit heart (the only neon in the nav).
 * `Heart` is exported for reuse as the house glyph.
 */
export function Heart({ className = "h-2.5 w-2.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 14" className={className} aria-hidden>
      <path d="M8 13.2S1 9 1 4.6C1 2.4 2.7.8 4.7.8c1.4 0 2.6.8 3.3 2 .7-1.2 1.9-2 3.3-2 2 0 3.7 1.6 3.7 3.8C15 9 8 13.2 8 13.2Z" fill="currentColor" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`}>
      <Heart className="wordmark-heart" />
      <span>simp machine</span>
    </span>
  );
}
