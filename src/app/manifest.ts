import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Zenvio",
    short_name: "Zenvio",
    description: "Good things, on the calendar.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#F7F9FF",
    theme_color: "#151B38",
    categories: ["business", "productivity"],
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Calendar", url: "/app/calendar", icons: [{ src: "/brand/icon-192.png", sizes: "192x192" }] },
      { name: "Inbox", url: "/app/inbox", icons: [{ src: "/brand/icon-192.png", sizes: "192x192" }] },
      { name: "Clients", url: "/app/clients", icons: [{ src: "/brand/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
