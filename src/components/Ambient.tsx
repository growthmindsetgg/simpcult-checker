/** fixed ambient layers: aurora orbs, vignette, film grain */
export function Ambient() {
  return (
    <>
      <div className="aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="vignette" aria-hidden />
      <div className="grain" aria-hidden />
    </>
  );
}
