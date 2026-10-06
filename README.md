# simp cult — simpcult.xyz

Next.js 16 site for the Monad Simp Cult NFT: lore, fully on-chain DAO, and a
single gateway (`/join`) that proves wallet ownership and binds a telegram
account to the holders-only group.

```
src/app/            pages + API routes (app router)
  /                 home (hero · story · two doors)
  /join             4-step gateway (connect · prove · bind telegram · done)
  /dao              proposals + voting
  /api/join/*       self-tx challenge + confirm
  /api/auth/*       SIWE + nonce + session
  /api/telegram/*   bot webhook + /link
  /api/cron/recheck hourly holder re-check
src/components/     nav, footer, wallet modal, dao cards, Toast, GlobalRipple
src/lib/            config, wagmi, dao hooks, session hooks
src/lib/server/     chain client, kv store, sessions, telegram bot (server only)
contracts/          Foundry project — SimpDAO.sol + tests + deploy script
```

## the gateway (`/join`)

`/verify` and `/security` 301-redirect to `/join`; `/checker` 301-redirects to
`/`. Four accordion cards — only the active one is expanded:

1. **connect wallet** — any EIP-6963 injected wallet or WalletConnect.
2. **prove it's yours** — default is a **self-transaction**: the server issues
   a unique random amount between `0.001` and `0.003` MON (6 random decimal
   digits, e.g. `0.001734 MON`), stored in Upstash under the lowercase address
   for 15 minutes. The user sends that exact amount from their wallet to
   itself; the server verifies `from == to == address`, `value == amountWei`,
   `status == success`, and the block timestamp is within the 15-min window.
   A small "sign a message instead (free)" link exposes the existing SIWE
   flow for wallets that don't want to pay gas. The server always re-reads
   the NFT balance from chain; `<1` returns a clear message with an OpenSea
   link.
3. **bind telegram** — holder types their `@username` (5–32 chars, letters/
   digits/underscore). The one-time code is stored with that handle; the bot
   only accepts the handshake from the matching `ctx.from.username`
   (case-insensitive). Mismatch → `"this code was bound to @X — verify again
   from the site with your current username"` and no invite.
4. **done** — "check telegram for your invite" + one-liner about `/status`
   and `/unlink`.

Existing re-check / kick / one-wallet-one-account logic is preserved
(`src/lib/server/telegram.ts`).

## 1. run locally

```bash
npm install
cp .env.example .env.local     # fill at least SESSION_SECRET
npm run dev                    # http://localhost:3000
```

Without Upstash env vars the app falls back to an in-memory store — fine for
local dev, NOT for Vercel: challenge amounts and telegram codes would not
persist between requests.

## 2. environment variables

Public (safe, build-time baked):

- `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SITE_DOMAIN`
- `NEXT_PUBLIC_MONAD_RPC`
- `NEXT_PUBLIC_NFT_ADDRESS` (ERC-721, Monad Simp Cult)
- `NEXT_PUBLIC_DAO_ADDRESS` (after `forge script` deploy)
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (optional — enables QR / mobile)
- `NEXT_PUBLIC_TELEGRAM_BOT` (bot username without `@`)

Server-only (secrets):

- `SESSION_SECRET` — `openssl rand -hex 32` (≥32 chars; required in prod)
- `MONAD_RPC` — private RPC for server reads (optional)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — **required in prod**;
  storage for the self-tx challenges and telegram link codes
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_GROUP_ID`, `TELEGRAM_WEBHOOK_SECRET`
- `CRON_SECRET` — matches `vercel.json`'s daily cron auth

## 3. deploy the DAO contract (Monad mainnet, chain 143)

```bash
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts --no-git
forge test                     # 12 tests

NFT=0xd8830709f8527033e03f44217ad093624997e60f \
OWNER=<your wallet or multisig> QUORUM=20 PERIOD=259200 COOLDOWN=86400 \
forge script script/Deploy.s.sol --rpc-url https://rpc.monad.xyz --broadcast --private-key $PK
```

Paste the printed address into `NEXT_PUBLIC_DAO_ADDRESS` and verify the source
on monadvision/monadscan. 1 NFT = 1 vote, cast **per tokenId**; a token can't
vote twice on the same proposal even if sold mid-vote.

## 4. deploy the site on Vercel

1. Push to GitHub, import in Vercel (framework: Next.js).
2. Vercel → Storage / Marketplace → **Upstash Redis** → connect. If the CLI
   `vercel integration add upstash` won't open the browser, do it in the
   dashboard: *Project → Storage → Create → Upstash Redis → Connect*. Vercel
   injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
   automatically.
3. Add the rest of `.env.example` as environment variables. `NEXT_PUBLIC_*`
   are baked at **build** time — redeploy after changes.
4. Domain: add `simpcult.xyz` and point DNS.
5. `vercel.json` schedules `/api/cron/recheck` daily on the Hobby plan.

## 5. telegram holder gate

1. @BotFather → `/newbot` → token → `TELEGRAM_BOT_TOKEN`; username →
   `NEXT_PUBLIC_TELEGRAM_BOT` (without `@`).
2. Make the group private, add the bot as **admin** with *invite users via
   link* and *ban users* rights. Get the chat id → `TELEGRAM_GROUP_ID`
   (`-100…`).
3. `TELEGRAM_WEBHOOK_SECRET`: random string. Register the webhook once:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://simpcult.xyz/api/telegram/webhook&secret_token=<SECRET>&allowed_updates=%5B%22message%22%2C%22chat_member%22%5D
   ```
4. Flow: holder completes steps 1–2 on `/join`, types their `@username` in
   step 3, bot checks `ctx.from.username` matches the stored handle, re-reads
   NFT balance on-chain, hands out a single-use invite (10 min). Bot
   commands: `/status`, `/unlink`. Cron kicks non-holders. Anyone sneaking in
   via another link is removed on the `chat_member` update unless linked +
   holding.

## 6. wallet security model (summary — full version is in `/join` → "how this stays safe")

- One chain (Monad 143). Connectors: EIP-6963 injected + WalletConnect
  (gated by `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`).
- Verification = SIWE (EIP-4361) **or** a self-transaction with a server-
  issued random MON amount. The site never requests approvals.
- Sessions are HMAC-signed httpOnly cookies; holder status is re-read from
  chain for every gated action.
- Strict CSP + security headers in `next.config.ts`.

## 7. content you maintain

- `data/archive-proposals.json` — pre-DAO votes shown under DAO → archive.
- `src/lib/config.ts` — links, team credits, addresses (env overrides).
- `public/media/` — `Homepage.mp4` (home background), `story-image.jpg`.

## scripts

```
npm run dev / build / start / lint
node scripts/screenshots.mjs       # desktop + mobile smoke shots
cd contracts && forge test
```
