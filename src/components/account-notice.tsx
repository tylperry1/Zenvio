"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
// Confirms a completed account deletion after the redirect home.
export function AccountNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("account") !== "deleted") return;
    setShow(true);
    url.searchParams.delete("account");
    window.history.replaceState(null, "", url);
  }, []);
  if (!show) return null;
  return (
    <div className="mk-account-notice" role="status">
      <Icon name="check" size={16} /> Your account and its data have been deleted.
      <button aria-label="Dismiss" onClick={() => setShow(false)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
