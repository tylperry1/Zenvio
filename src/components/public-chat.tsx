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
    // Signed-in people use the help button in their workspace instead.
    fetch("/api/support", { cache: "no-store" })
      .then((r) => !stopped && setSignedOut(r.status === 401))
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [allowed]);
  return allowed && signedOut ? <VisitorChatWidget /> : null;
}
