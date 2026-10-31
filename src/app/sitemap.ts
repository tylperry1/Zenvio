import type { MetadataRoute } from "next";

// Only public marketing pages. Never enumerate accounts, documents or bearer URLs.
export default function sitemap(): MetadataRoute.Sitemap {
  if (process.env.VERCEL_ENV === "preview") return [];
  return ["", "/pricing", "/early-access", "/privacy", "/terms"].map(path => ({
    url: `https://gozenvio.com${path}`,
  }));
}
