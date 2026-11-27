import s from "@/casino/scene/poster.module.css";

/**
 * The hero's first paint: a still of the 3D stage's resting frame (Keone at
 * the machine under the neon, 3/4 from behind), rendered by the stage itself
 * and saved to public/casino. It is in the server HTML, so the page never
 * opens on a black box: on the high and mid tiers the live canvas fades in
 * over it once it draws (the intro starts from this same frame), and on the
 * low tier (no WebGL, Save-Data) it is the whole hero.
 *
 * Portrait screens get a portrait still with the subject above the copy.
 */
export function HeroPoster() {
  return (
    <div className={s.poster} aria-hidden>
      <picture>
        <source media="(max-aspect-ratio: 1/1)" type="image/avif" srcSet="/casino/hero-poster-tall.avif" />
        <source media="(max-aspect-ratio: 1/1)" type="image/webp" srcSet="/casino/hero-poster-tall.webp" />
        <source type="image/avif" srcSet="/casino/hero-poster-wide.avif" />
        {/* a plain <img>: the stills are pre-encoded at their final size, and next/image's
            optimizer would only re-encode them and push the first paint later */}
        <img src="/casino/hero-poster-wide.webp" alt="" width={1920} height={1200} fetchPriority="high" decoding="sync" />
      </picture>
    </div>
  );
}
