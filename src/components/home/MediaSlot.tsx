import Image from "next/image";
import type { ArtSlot } from "./slots";

const DEV = process.env.NODE_ENV !== "production";

/**
 * An art frame. Renders the image when `slot.src` is set, otherwise a marked
 * placeholder ("art drop soon") with the expected file path shown in dev.
 */
export function MediaSlot({
  slot,
  className = "",
  sizes = "(min-width: 768px) 33vw, 50vw",
  label = "art drop soon",
}: {
  slot: ArtSlot;
  className?: string;
  sizes?: string;
  label?: string;
}) {
  if (slot.src) {
    return (
      <figure className={`slot ${className}`} data-slot={slot.id}>
        {/* local art that is already sized: skip the optimizer (it also refuses SVG) */}
        <Image src={slot.src} alt={slot.alt} fill sizes={sizes} unoptimized className="object-cover" />
      </figure>
    );
  }
  return (
    <figure className={`slot slot-empty ${className}`} data-slot={slot.id} data-slot-file={slot.file}>
      <svg viewBox="0 0 24 24" className="slot-heart" aria-hidden>
        <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.5 0 5.4 3.5 4.1 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z" />
      </svg>
      <figcaption>
        <span className="slot-label">{label}</span>
        {DEV && <span className="slot-file">{slot.file}</span>}
      </figcaption>
    </figure>
  );
}
