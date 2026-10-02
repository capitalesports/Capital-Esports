import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/dashboard",
          "/profile",
          "/teams",
          "/notifications",
          "/payments",
          "/api/",
          "/login",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
