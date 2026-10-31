import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  if (process.env.VERCEL_ENV === "preview")
    return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: [
      "/app", "/admin", "/api", "/portal", "/sign", "/cancel", "/reschedule",
      "/reset-password", "/team", "/request", "/book", "/demo", "/marketplace",
    ] },
    sitemap: "https://gozenvio.com/sitemap.xml",
  };
}
