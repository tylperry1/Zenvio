import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { ServiceWorkerRegister } from "@/components/pwa";
import { PublicChat } from "@/components/public-chat";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});
import "./platform.css";
import "./refinements.css";
import "./documents.css";
import "./suite.css";
import "./shell.css";
import "./workspace-design.css";
import "./ui.css";
import "./experience.css";
import "./subscriptions.css";
import "./design-system.css";
import "./workspace-polish.css";
import "./growth-suite.css";
import "./rebrand.css";
import "./profile-studio.css";
export const metadata: Metadata = {
  title: {
    default: "Zenvio — Good things, on the calendar.",
    template: "%s | Zenvio",
  },
  description:
    "Less back-and-forth. More possibility. Share a booking link, manage your availability, and keep appointments and client relationships together.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://gozenvio.com",
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
  appleWebApp: { capable: true, title: "Zenvio", statusBarStyle: "default" },
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
export const viewport: Viewport = { themeColor: "#151B38" };
import {LaunchBanner} from "@/components/launch-banner";
import { PublicThemeSync } from "@/components/public-theme-sync";
import { ThemeBootScript } from "@/components/theme-boot";
import { ThemeProvider } from "@/components/theme-control";
import { themeSessionActive } from "@/lib/theme-session";
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [controls, signedIn] = await Promise.all([
    (await import("@/lib/launch-controls")).launchControls(),
    themeSessionActive(),
  ]);
  const body = (
    <>
      {controls.bannerEnabled&&controls.banner&&<LaunchBanner text={controls.banner} date={controls.launchDate}/>}
      {children}
      <ServiceWorkerRegister />
      <PublicChat />
      <Analytics />
    </>
  );
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body data-smart-cards={String(controls.features.smartCards)} data-growth={String(controls.features.growth)} data-assistant={String(controls.features.assistant)} suppressHydrationWarning>
        {/* Boot on every route so public pages honor stored/system theme on first paint. */}
        <ThemeBootScript />
        {signedIn ? (
          <ThemeProvider>{body}</ThemeProvider>
        ) : (
          <>
            <PublicThemeSync />
            {body}
          </>
        )}
      </body>
    </html>
  );
}

