# simp cult — simpcult.xyz

Next.js 16 site for the Monad Simp Cult NFT: story + WL checker, secure wallet
verification, fully on-chain DAO, and a Telegram holder gate.

```
src/app/            pages + API routes (app router)
src/components/     nav, footer, wallet modal, dao cards, Toast, GlobalRipple
src/lib/            config, wagmi, dao hooks, session hooks
src/lib/server/     chain client, kv store, sessions, telegram bot (server only)
contracts/          Foundry project — SimpDAO.sol + tests + deploy script
data/               whitelist.json (checker), archive-proposals.json (old votes)
public/media/       videos + story image
```

## interaction polish (v2)

- **Nav** — subtle magnetic hover + a 1px animated underline on the active
  route (`.nav-link`, gated by `prefers-reduced-motion`).
- **Cards** — `Spotlight` now also tracks pointer position to add a max 6°
  3D tilt via CSS vars (`--rx`, `--ry`, `--tz`) written into a `.tilt` shell.
- **Buttons** — a global `<GlobalRipple />` in the layout delegates a press
  ripple to any `.pillbtn` or `.btn-primary`; no per-button wiring.
- **Toast store** — dep-free singleton in `src/components/Toast.tsx` backed by
  `useSyncExternalStore`. Import `toast` and call `toast.ok / .info / .bad /
  .warn`. Bottom-right glass toasts, auto-dismiss.
- **Checker** — result card springs in, includes a copy-address button and,
  when eligible, a shareable X-intent link.
- **DAO** — vote bars animate from 0 on reveal (IntersectionObserver). Voting
  shows a pending pill + optimistic bar bump until the tx mines; toasts fire on
  send / mined / failed.
- **Wallet modal** — a connect → verify step indicator up top; a spring
  checkmark icon animates in on first entry to the verified view.
- **Verify** — the active step glows via `.pulse-neon`; a vertical `.step-track`
  fills its height as steps complete.
- **Home** — a soft cursor-following glow sits behind the neon muse; scroll
  drives a slower parallax so the muse drifts behind page content.
- All motion primitives respect `prefers-reduced-motion`.

## 1. run locally

```bash
npm install
cp .env.example .env.local     # fill at least SESSION_SECRET
npm run dev                    # http://localhost:3000
```

Without Upstash env vars the app uses an in-memory store — fine for local dev,
NOT for Vercel (nonces / telegram links would not persist between requests).

## 2. deploy the DAO contract (Monad mainnet, chain 143)

```bash
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts --no-git   # lib/ is not committed
forge test                     # 12 tests

NFT=0xd8830709f8527033e03f44217ad093624997e60f \
OWNER=<your wallet or multisig> QUORUM=20 PERIOD=259200 COOLDOWN=86400 \
forge script script/Deploy.s.sol --rpc-url https://rpc.monad.xyz --broadcast --private-key $PK
```

Copy the printed address into `NEXT_PUBLIC_DAO_ADDRESS`. Verify the source on
monadvision/monadscan so voters can read it. Parameters (all changeable later by
the owner via `setConfig`): `proposalThreshold` NFTs needed to propose, `quorum`
total votes needed, `votingDelay`, `votingPeriod`, `proposalCooldown` per wallet.

How voting works: 1 NFT = 1 vote, cast **per tokenId** — a token can never vote
twice on the same proposal even if it is sold mid-vote. Choices: for / against /
abstain. Result = for > against and total ≥ quorum. Proposer or owner can cancel
before the end; nobody can edit a tally.

## 3. deploy the site on Vercel

1. Push this folder to GitHub, import in Vercel (framework: Next.js).
2. Vercel → Storage / Marketplace → **Upstash Redis** → connect; it injects
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
3. Add the rest of `.env.example` as environment variables. `NEXT_PUBLIC_*` vars
   are baked in at **build** time — redeploy after changing them.
   `SESSION_SECRET`: `openssl rand -hex 32`. `CRON_SECRET`: same.
4. Domain: add `simpcult.xyz` in Vercel and point DNS there (replace the GitHub
   Pages CNAME).
5. `vercel.json` schedules `/api/cron/recheck` hourly (Telegram re-check).

## 4. telegram holder gate

1. @BotFather → `/newbot` → token → `TELEGRAM_BOT_TOKEN`; username →
   `NEXT_PUBLIC_TELEGRAM_BOT` (without @).
2. Make the group private, add the bot as **admin** with *invite users via link*
   and *ban users* rights. Get the chat id (e.g. add @RawDataBot, or forward a
   message to @userinfobot) → `TELEGRAM_GROUP_ID` (looks like `-100…`).
3. `TELEGRAM_WEBHOOK_SECRET`: random string. Register the webhook once:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://simpcult.xyz/api/telegram/webhook&secret_token=<SECRET>&allowed_updates=%5B%22message%22%2C%22chat_member%22%5D
   ```
4. Flow: holder verifies on `/verify` → "join telegram" → bot re-checks balance
   on-chain → single-use invite link (10 min). Bot commands: `/status`, `/unlink`.
   Hourly cron kicks wallets that no longer hold. Anyone who sneaks in via
   another link is removed on the `chat_member` update unless linked + holding.

## 5. wallet security model (see /security on the site)

- One chain configured (Monad 143). Connectors: EIP-6963 injected wallets +
  WalletConnect (only if `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set).
- Verification = Sign-In With Ethereum (EIP-4361): domain-bound, chain-bound,
  single-use server nonce (5 min TTL, consumed atomically). Smart wallets
  supported via ERC-1271/6492.
- Fallback = 0-MON self-transaction with the nonce in calldata (for wallets that
  cannot sign messages). Server checks from == to, value 0, calldata, mined,
  < 30 min old.
- The site never requests approvals. The only writes are DAO `propose` /
  `castVote` / `cancel` and the optional self-tx.
- Strict CSP + security headers in `next.config.ts`. Sessions are HMAC-signed
  httpOnly cookies; holder status is re-read from chain for every gated action.
- **Pocket Universe**: it is a browser extension users install themselves; there
  is no API a site can integrate. Its published chain list did not include Monad
  at time of writing, so the site is built to be safe without it, and recommends
  it (and wallets with built-in simulation like Rabby) as an extra layer.

## 6. content you maintain

- `data/whitelist.json` — the WL checker list (`{ "0x…": { gtd, fcfs } }`).
- `data/archive-proposals.json` — old (pre-DAO) votes shown under DAO → archive.
  Delete the example entry and add one object per past vote.
- `src/lib/config.ts` — links, team credits, addresses (env overrides).
- `public/media/` — Homepage.mp4 (home bg), lambedesign.mp4 (checker bg).

## scripts

```
npm run dev / build / start / lint
cd contracts && forge test
```
