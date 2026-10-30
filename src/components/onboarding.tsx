"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { Modal } from "./modal";
import type { WorkspaceData } from "@/lib/types";

const DISMISSED_KEY = "zenvio-setup-dismissed";
const LINK_SKIPPED_KEY = "zenvio-link-prompt-skipped";

// New accounts start with a generated "host-<id>" address.
export const hasGeneratedLink = (slug: string) => /^host-[0-9a-f]{32}$/.test(slug);

export function suggestSlug(name: string) {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base.length >= 3 ? base : "";
}

function stored(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function store(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {}
}

export function useLinkPrompt(data: WorkspaceData | null, demo: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (data && !demo && hasGeneratedLink(data.profile.slug) && !stored(LINK_SKIPPED_KEY))
      setOpen(true);
  }, [data, demo]);
  return {
    open,
    show: () => setOpen(true),
    close: () => {
      store(LINK_SKIPPED_KEY);
      setOpen(false);
    },
    done: () => setOpen(false),
  };
}

export function BookingLinkPrompt({
  data,
  busy,
  onSave,
  onClose,
}: {
  data: WorkspaceData;
  busy: boolean;
  onSave: (slug: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(
    hasGeneratedLink(data.profile.slug)
      ? suggestSlug(data.profile.company || data.profile.name)
      : data.profile.slug,
  );
  const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length >= 3;
  const origin = typeof window === "undefined" ? "" : window.location.host;
  return (
    <Modal title="Choose your booking link" onClose={() => !busy && onClose()}>
      <form
        className="link-prompt"
        onSubmit={async (e) => {
          e.preventDefault();
          if (valid) await onSave(value);
        }}
      >
        <p>
          This is the address you share with clients. Pick something short and
          recognizable — you can change it later in Settings.
        </p>
        <label>
          Booking link
          <span className="link-prompt-field">
            <span>{origin}/book/</span>
            <input
              autoFocus
              value={value}
              maxLength={60}
              onChange={(e) =>
                setValue(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
              }
              aria-describedby="link-prompt-help"
            />
          </span>
        </label>
        <small id="link-prompt-help">
          Lowercase letters, numbers, and hyphens. At least 3 characters.
        </small>
        <div className="link-prompt-actions">
          <button type="button" className="button secondary small" disabled={busy} onClick={onClose}>
            Not now
          </button>
          <button className="button primary small" disabled={busy || !valid}>
            {busy ? "Saving…" : "Save link"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Step = {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  action: { label: string; href?: string; onClick?: () => void };
};

export function SetupChecklist({
  data,
  demo,
  base,
  onChooseLink,
  onCopyLink,
}: {
  data: WorkspaceData;
  demo: boolean;
  base: string;
  onChooseLink: () => void;
  onCopyLink: () => void;
}) {
  const [dismissed, setDismissed] = useState(true);
  const [calendar, setCalendar] = useState<{ configured: boolean; connected: boolean } | null>(null);
  useEffect(() => setDismissed(stored(DISMISSED_KEY)), []);
  useEffect(() => {
    if (demo) return;
    fetch("/api/calendars/google", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        d && setCalendar({ configured: !!d.configured, connected: (d.connections || []).length > 0 }),
      )
      .catch(() => {});
  }, [demo]);
  const steps: Step[] = [
    {
      id: "link",
      title: "Choose your booking link",
      detail: "A short, recognizable address for clients.",
      done: !hasGeneratedLink(data.profile.slug),
      action: { label: "Choose link", onClick: onChooseLink },
    },
    {
      id: "profile",
      title: "Introduce yourself",
      detail: "Add a headline and short bio to your booking page.",
      done: !!(data.profile.headline || data.profile.bio),
      action: { label: "Edit profile", href: `${base}?view=settings` },
    },
    {
      id: "hours",
      title: "Set your weekly hours",
      detail: "Guests can only book inside your availability.",
      done: data.availability.length > 0,
      action: { label: "Set hours", href: `${base}?view=availability` },
    },
    ...(calendar?.configured
      ? [
          {
            id: "calendar",
            title: "Connect your calendar",
            detail: "Avoid double-booking with your existing events.",
            done: calendar.connected,
            action: { label: "Connect", href: "/app/connections" },
          },
        ]
      : []),
    {
      id: "share",
      title: "Share your page and get a first booking",
      detail: "Paste your link in your email signature or a message.",
      done: (data.bookingCount ?? data.bookings.length) > 0,
      action: { label: "Copy link", onClick: onCopyLink },
    },
  ];
  const complete = steps.filter((s) => s.done).length;
  if (dismissed || complete === steps.length) return null;
  return (
    <section className="setup-checklist" aria-label="Getting started">
      <header>
        <div>
          <h2>Get set up</h2>
          <p>
            {complete} of {steps.length} done
          </p>
        </div>
        <div className="setup-progress" aria-hidden="true">
          <span style={{ width: `${(complete / steps.length) * 100}%` }} />
        </div>
        <button
          className="setup-dismiss"
          aria-label="Hide setup checklist"
          onClick={() => {
            store(DISMISSED_KEY);
            setDismissed(true);
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </header>
      <ol>
        {steps.map((step) => (
          <li key={step.id} className={step.done ? "done" : ""}>
            <span className="setup-check" aria-hidden="true">
              {step.done && <Icon name="check" size={14} />}
            </span>
            <div>
              <b>{step.title}</b>
              <small>{step.detail}</small>
            </div>
            {step.done ? (
              <span className="setup-done-label">Done</span>
            ) : step.action.href ? (
              <Link className="button secondary small" href={step.action.href}>
                {step.action.label}
              </Link>
            ) : (
              <button className="button secondary small" onClick={step.action.onClick}>
                {step.action.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
