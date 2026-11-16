"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
// The app already depends on react-dom; no separate @types/react-dom package is installed.
// @ts-expect-error react-dom ships with React and exposes createPortal at runtime.
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import {
  canNativeShare,
  copyText,
  emailShareHref,
  publicShareUrl,
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
  shareLabel = "Share",
  buttonClass,
  copiedMessage,
  className = "",
  onResult,
}: {
  url: string;
  title: string;
  text?: string;
  label: string;
  variant?: "bar" | "compact" | "buttons" | "trigger";
  shareLabel?: string;
  buttonClass?: string;
  copiedMessage?: string;
  className?: string;
  onResult?: (result: ShareResult, message: string) => void;
}) {
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("");
  const [href, setHref] = useState("");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  useEffect(() => {
    setHref(publicShareUrl(url, window.location.origin));
  }, [url]);
  const payload: SharePayload = { url: href || url, title, text };

  function placeMenu() {
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    const width = 196;
    const left = Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8));
    const openUp = window.innerHeight - box.bottom < 168 && box.top > 168;
    setMenuStyle({
      position: "fixed",
      left,
      width,
      top: openUp ? undefined : box.bottom + 6,
      bottom: openUp ? window.innerHeight - box.top + 6 : undefined,
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
    (menuRef.current?.querySelector("button, a") as HTMLElement | null)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const node = event.target as Node;
      if (root.current?.contains(node) || menuRef.current?.contains(node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onMove = () => placeMenu();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  function report(result: ShareResult) {
    const message = shareResultMessage(result, copiedMessage);
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
    if (!message) return;
    if (onResult) onResult(result, message);
    else setStatus(message);
  }

  async function share() {
    if (canNativeShare(payload)) {
      const result = await shareOrCopy(payload);
      if (result === "cancelled") return;
      if (result === "unavailable") {
        report(result);
        setOpen(true);
        return;
      }
      report(result);
      return;
    }
    setOpen((v) => !v);
  }

  async function copy() {
    const ok = await copyText(href || url);
    report(ok ? "copied" : "unavailable");
    if (ok) setOpen(false);
  }

  const shareClass =
    buttonClass ||
    (variant === "compact"
      ? "inline-link"
      : variant === "buttons"
        ? "ds-btn sm primary"
        : variant === "trigger"
          ? "button primary small"
          : "ui-btn ui-btn-primary ui-btn-sm");
  const copyClass =
    variant === "compact" ? "inline-link" : variant === "buttons" ? "ds-btn sm" : "ui-btn ui-btn-secondary ui-btn-sm";

  const shareButton = (
    <button
      ref={trigger}
      type="button"
      className={shareClass}
      aria-expanded={open}
      aria-controls={menuId}
      disabled={!href}
      onClick={() => void share()}
    >
      <Icon name="share" size={15} /> {shareLabel}
    </button>
  );
  const copyButton =
    variant === "trigger" ? null : (
      <button type="button" className={copyClass} disabled={!href} onClick={() => void copy()}>
        <Icon name={copied ? "check" : "link"} size={15} /> {copied ? "Copied" : "Copy"}
      </button>
    );
  const menuHost =
    typeof document === "undefined"
      ? null
      : trigger.current?.closest("dialog") || document.body;
  const menu =
    open && menuHost
      ? createPortal(
          <div ref={menuRef} id={menuId} className="share-menu" style={menuStyle}>
            <input
              readOnly
              className="share-menu-url"
              value={href || url}
              aria-label={label}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" onClick={() => void copy()}>
              <Icon name="link" size={15} /> Copy link
            </button>
            <a href={emailShareHref(payload)} onClick={() => setOpen(false)}>
              <Icon name="mail" size={15} /> Email
            </a>
            <a href={smsShareHref(payload)} onClick={() => setOpen(false)}>
              <Icon name="message" size={15} /> Text message
            </a>
          </div>,
          menuHost,
        )
      : null;

  if (variant !== "bar") {
    return (
      <div ref={root} className={`share-actions share-actions-${variant} ${className}`.trim()}>
        {shareButton}
        {copyButton}
        {menu}
        {status ? <p className="share-status">{status}</p> : null}
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
      {status ? <p className="share-status">{status}</p> : null}
    </div>
  );
}
