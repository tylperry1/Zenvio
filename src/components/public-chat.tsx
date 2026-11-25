"use client";
import { usePathname } from "next/navigation";
import { VisitorChatWidget } from "./visitor-support";

// Zenvio's own public pages. Pages that belong to a customer's business
// (booking pages, client portals, signing links, public profiles, shops) are
// deliberately excluded so their clients never see Zenvio's support chat.
const PUBLIC_PATHS = [
  /^\/$/,
  /^\/pricing\/?$/,
  /^\/help\/?$/,
  /^\/sign-in\/?$/,
  /^\/sign-up\/?$/,
  /^\/early-access\/?$/,
  /^\/reset-password\/?$/,
  /^\/privacy\/?$/,
  /^\/terms\/?$/,
  /^\/demo(\/|$)/,
  /^\/marketplace(\/|$)/,
];

/**
 * "Chat with us" for signed-out visitors on Zenvio's public pages. The session
 * comes from the root layout, so the gate needs no client request: signed-in
 * people use the help button in their workspace instead.
 */
export function PublicChat({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() || "/";
  return !signedIn && PUBLIC_PATHS.some((path) => path.test(pathname)) ? <VisitorChatWidget /> : null;
}
