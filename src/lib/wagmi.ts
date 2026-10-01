import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { CHAIN, RPC_URL } from "./config";

/**
 * Wallet config — security posture:
 *  - Only Monad mainnet is configured. Nothing on this site ever asks you to
 *    switch to another chain.
 *  - Connectors are limited to injected (EIP-6963 discovered) wallets and
 *    WalletConnect. No custom / unknown providers.
 *  - The site never requests token approvals or setApprovalForAll.
 *    The only on-chain writes are DAO propose/vote and the optional
 *    0-value self-transaction used for verification.
 */
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [
    injected({ shimDisconnect: true }),
    ...(wcProjectId
      ? [
          walletConnect({
            projectId: wcProjectId,
            showQrModal: true,
            metadata: {
              name: "simp cult",
              description: "simp cult — monad nft collection & dao",
              url: "https://simpcult.xyz",
              icons: ["https://simpcult.xyz/favicon.ico"],
            },
          }),
        ]
      : []),
  ],
  multiInjectedProviderDiscovery: true,
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  transports: { [CHAIN.id]: http(RPC_URL) },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
