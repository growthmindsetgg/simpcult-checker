import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Ambient } from "@/components/Ambient";
import { Toaster } from "@/components/Toast";
import { GlobalRipple } from "@/components/GlobalRipple";
import { SITE } from "@/lib/config";

const michroma = localFont({
  src: "./fonts/Michroma.woff2",
  variable: "--font-display",
  display: "swap",
  weight: "400",
});

const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
});

const NAME = "simp machine";
const DESCRIPTION = "be an active simp, stack SIMP Points, feed them to the machine. the simp cult on monad.";

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
    images: [{ url: "/media/story-image.jpg" }],
  },
  twitter: { card: "summary_large_image", site: "@monadsimpcult" },
};

export const viewport: Viewport = { themeColor: "#0b0510", colorScheme: "dark" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookie = (await headers()).get("cookie");
  return (
    <html lang="en" className={`${inter.variable} ${michroma.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="skip-link">skip to content</a>
        <Providers cookie={cookie}>
          <Ambient />
          <GlobalRipple />
          <Nav />
          <main id="main" className="flex flex-1 flex-col">{children}</main>
          <Footer />
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
