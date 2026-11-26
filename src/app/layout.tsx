import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Toaster } from "@/components/Toast";
import { SITE } from "@/lib/config";

const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
});

/* casino signage: Bodoni Moda, variable (opsz 6–96 + wght 400–900) */
const bodoni = localFont({
  src: [
    { path: "../../node_modules/@fontsource-variable/bodoni-moda/files/bodoni-moda-latin-standard-normal.woff2", style: "normal" },
    { path: "../../node_modules/@fontsource-variable/bodoni-moda/files/bodoni-moda-latin-standard-italic.woff2", style: "italic" },
  ],
  variable: "--font-bodoni",
  display: "swap",
  weight: "400 900",
  fallback: ["Didot", "Georgia", "serif"],
});

/* ledgers, tickets, numbers */
const mono = localFont({
  src: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "100 800",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
});

const NAME = "simp machine";
const DESCRIPTION = "check in, post, bring alpha. stack SIMP Points and feed them to the machine. the simp cult on monad.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${NAME} · ${SITE.name}`, template: `%s · ${NAME}` },
  description: DESCRIPTION,
  icons: { icon: "/favicon.ico" },
  openGraph: {
    title: NAME,
    description: DESCRIPTION,
    url: SITE.url,
    siteName: SITE.name,
    images: [{ url: "/media/nft/simp-137.webp", width: 480, height: 480, alt: "simp cult #137" }],
  },
  twitter: { card: "summary", site: "@monadsimpcult" },
};

export const viewport: Viewport = { themeColor: "#0a0610", colorScheme: "dark", viewportFit: "cover" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookie = (await headers()).get("cookie");
  return (
    <html lang="en" className={`${inter.variable} ${bodoni.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="skip-link">skip to content</a>
        <Providers cookie={cookie}>
          <Nav />
          <main id="main" className="flex flex-1 flex-col">{children}</main>
          <Footer />
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
