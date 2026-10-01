import { LINKS, TEAM, NFT_ADDRESS, explorerAddress, short } from "@/lib/config";

export function Footer() {
  return (
    <footer className="relative z-10 bg-bg/85 backdrop-blur-xl">
      <div className="divider" />
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 text-[13.5px] text-dim md:grid-cols-3">
        <div>
          <div className="t-h3 mb-3 text-[15px] text-simp-2">simp cult</div>
          <p className="max-w-xs leading-relaxed">
            simping for what truly matters, until you actually get it. built on
            monad.
          </p>
          <div className="mono mt-4 text-mute">
            nft ·{" "}
            <a className="link" href={explorerAddress(NFT_ADDRESS)} target="_blank" rel="noreferrer">
              {short(NFT_ADDRESS)}
            </a>
          </div>
        </div>

        <div>
          <div className="t-h3 mb-3 text-[15px] text-simp-2">links</div>
          <ul className="space-y-2.5">
            <li><a className="link" href={LINKS.opensea} target="_blank" rel="noreferrer">opensea collection</a></li>
            <li><a className="link" href={LINKS.x} target="_blank" rel="noreferrer">@monadsimpcult on x</a></li>
            <li><a className="link" href={LINKS.github} target="_blank" rel="noreferrer">github</a></li>
            <li><a className="link" href="/security">security</a></li>
          </ul>
        </div>

        <div>
          <div className="t-h3 mb-3 text-[15px] text-simp-2">the cult</div>
          <ul className="space-y-2.5">
            {TEAM.map((t) => (
              <li key={t.handle}>
                <span className="text-mute">{t.role} — </span>
                <a className="link" href={`https://x.com/${t.handle}`} target="_blank" rel="noreferrer">
                  @{t.handle}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
