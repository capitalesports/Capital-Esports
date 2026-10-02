import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { SECURITY_HEADERS } from "./lib/security-headers";

/** Image routes read fonts and delivered artwork from disk; make sure deployments ship those files. */
const IMAGE_ROUTE_FILES = ["./assets/fonts/**", "./public/art/**", "./node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf"];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dev only: lets friends test through a temporary Cloudflare tunnel (npx cloudflared / trycloudflare).
  allowedDevOrigins: ["*.trycloudflare.com"],
  outputFileTracingIncludes: {
    "/scrims/[id]/opengraph-image*": IMAGE_ROUTE_FILES,
    "/tournament/[game]/opengraph-image*": IMAGE_ROUTE_FILES,
    "/leaderboard/[game]/card/[userId]": IMAGE_ROUTE_FILES,
    "/icons/[size]": IMAGE_ROUTE_FILES,
    "/icon*": IMAGE_ROUTE_FILES,
    "/apple-icon*": IMAGE_ROUTE_FILES,
  },
  experimental: {
    serverActions: {
      // Screenshots are downscaled client-side; this leaves headroom for 5 MB originals in dev.
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

// Sentry: source maps are uploaded only when SENTRY_AUTH_TOKEN/ORG/PROJECT are set.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
});
