import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — scrims & tournaments`,
    short_name: SITE_NAME,
    description: SITE_TAGLINE,
    start_url: "/dashboard",
    scope: "/",
    // "browser", not "standalone": the owner doesn't want browsers offering to install the site as an app.
    display: "browser",
    orientation: "portrait",
    background_color: "#12141f",
    theme_color: "#12141f",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
