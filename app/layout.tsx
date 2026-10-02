import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import { LazyToaster } from "@/components/providers/lazy-toaster";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import { SITE_NAME, SITE_TAGLINE, siteUrl } from "@/lib/site";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const barlow = Barlow_Condensed({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE_NAME} — Free Fire, BGMI & Valorant scrims`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_TAGLINE,
};

export const viewport: Viewport = {
  themeColor: "#0B0B0D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-IN"
      // Dark only (DECISIONS R0.1): a static class, no theme provider or inline theme script.
      className={`${inter.variable} ${barlow.variable} dark h-full antialiased`}
      style={{ colorScheme: "dark" }}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <LazyToaster />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
