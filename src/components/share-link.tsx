"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";
import {
  canNativeShare,
  copyText,
  emailShareHref,
  shareOrCopy,
  shareResultMessage,
  smsShareHref,
  type SharePayload,
  type ShareResult,
} from "@/lib/share";

export function ShareLinkActions({
  url,
  title,
  text,
  label,
  variant = "bar",
  copiedMessage,
  className = "",
  onResult,
}: {
  url: string;
  title: string;
  text?: string;
  label: string;
  variant?: "bar" | "compact" | "buttons";
  copiedMessage?: string;
  className?: string;
  onResult?: (result: ShareResult, message: string) => void;
}) {
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [href, setHref] = useState("");
  useEffect(() => {
    try {
      setHref(new URL(url, window.location.origin).href);
    } catch {
      setHref(url);
    }
  }, [url]);
  const payload: SharePayload = { url: href || url, title, text };

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function report(result: ShareResult) {
    const message = shareResultMessage(result, copiedMessage);
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
    if (message) onResult?.(result, message);
  }

  async function share() {
    if (canNativeShare(payload)) {
      report(await shareOrCopy(payload));
      return;
    }
    setOpen((v) => !v);
  }

  async function copy() {
    report((await copyText(href || url)) ? "copied" : "unavailable");
    setOpen(false);
  }

  const shareButton = (
    <button
      type="button"
      className={variant === "compact" ? "inline-link" : variant === "buttons" ? "ds-btn sm primary" : "ui-btn ui-btn-primary ui-btn-sm"}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={menuId}
      disabled={!href}
      onClick={() => void share()}
    >
      <Icon name="share" size={15} /> Share
    </button>
  );
  const copyButton = (
    <button
      type="button"
      className={variant === "compact" ? "inline-link" : variant === "buttons" ? "ds-btn sm" : "ui-btn ui-btn-secondary ui-btn-sm"}
      disabled={!href}
      onClick={() => void copy()}
    >
      <Icon name={copied ? "check" : "link"} size={15} /> {copied ? "Copied" : "Copy"}
    </button>
  );
  const menu = open ? (
    <div id={menuId} role="menu" className="share-menu">
      <button type="button" role="menuitem" onClick={() => void copy()}>
        <Icon name="link" size={15} /> Copy link
      </button>
      <a role="menuitem" href={emailShareHref(payload)} onClick={() => setOpen(false)}>
        <Icon name="mail" size={15} /> Email
      </a>
      <a role="menuitem" href={smsShareHref(payload)} onClick={() => setOpen(false)}>
        <Icon name="message" size={15} /> Text message
      </a>
    </div>
  ) : null;

  if (variant === "compact" || variant === "buttons") {
    return (
      <div ref={root} className={`share-actions share-actions-${variant} ${className}`.trim()}>
        {shareButton}
        {copyButton}
        {menu}
      </div>
    );
  }

  return (
    <div ref={root} className={`share-link-bar ${className}`.trim()}>
      <input
        readOnly
        className="ui-input"
        value={href || url}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="share-link-buttons">
        {shareButton}
        {copyButton}
        {menu}
      </div>
    </div>
  );
}

