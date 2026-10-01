import type { NextConfig } from "next";

/**
 * Security headers. CSP is deliberately strict: scripts only from this origin;
 * connections only to our API, Monad RPCs and WalletConnect relays.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // next.js inline runtime bootstrap
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self'",
  "font-src 'self' data:",
  "connect-src 'self' https://*.monad.xyz https://rpc-mainnet.monadinfra.com https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org https://*.reown.com wss://*.reown.com",
  "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org https://verify.reown.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["grammy"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
