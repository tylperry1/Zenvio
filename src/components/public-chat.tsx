"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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

/** "Chat with us" for signed-out visitors on Zenvio's public pages. */
export function PublicChat() {
  const pathname = usePathname() || "/";
  const allowed = PUBLIC_PATHS.some((p) => p.test(pathname));
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    if (!allowed) return;
    let stopped = false;
    // Signed-in people use the help button in their workspace instead. The
    // public visitor endpoint answers 200 for everyone, so this probe never
    // logs an expected 401 in the console.
    fetch("/api/support/visitor", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !stopped && setSignedOut(!!d && !d.signedIn))
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [allowed]);
  return allowed && signedOut ? <VisitorChatWidget /> : null;
}
