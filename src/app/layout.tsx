import type { Metadata } from "next";
import "./globals.css";
import "./platform.css";
import "./refinements.css";
export const metadata: Metadata = {
  title: {
    default: "Zenvio — Good things, on the calendar.",
    template: "%s | Zenvio",
  },
  description:
    "Less back-and-forth. More possibility. Share a booking link, manage your availability, and keep appointments and client relationships together.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://zenvio-two.vercel.app",
  ),
  applicationName: "Zenvio",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      {
        url: "/brand/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: "Zenvio",
    title: "Zenvio — Good things, on the calendar.",
    description:
      "Less back-and-forth. More possibility. A calmer way to schedule and keep client relationships together.",
    images: [
      {
        url: "/brand/og-share.png",
        width: 1200,
        height: 630,
        alt: "Zenvio — Good things, on the calendar.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Zenvio — Good things, on the calendar.",
    description: "Less back-and-forth. More possibility.",
    images: ["/brand/og-share.png"],
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
