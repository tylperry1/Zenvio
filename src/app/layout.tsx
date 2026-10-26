import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Zenvio — Make time for what matters.",
    template: "%s | Zenvio",
  },
  description:
    "A calmer way to schedule. Share a booking link, manage your availability, and keep your client relationships together.",
  icons: { icon: "/icon.svg" },
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
