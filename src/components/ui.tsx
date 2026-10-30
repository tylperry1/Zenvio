"use client";
// Shared building blocks for workspace and admin pages. Styles live in ui.css.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export function Card({
  title,
  description,
  actions,
  children,
  footer,
  flush = false,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <div className={`ui-card ${className}`}>
      {(title || actions) && (
        <div className="ui-card-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="ui-card-actions">{actions}</div>}
        </div>
      )}
      {children && <div className={flush ? "ui-card-flush" : "ui-card-body"}>{children}</div>}
      {footer && <div className="ui-card-foot">{footer}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;
}

export function Field({
  label,
  hint,
  children,
  wide = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`ui-field${wide ? " ui-field-wide" : ""}`}>
      <span className="ui-label">{label}</span>
      {children}
      {hint && <span className="ui-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`ui-toggle${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          className={value === t.id ? "active" : ""}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && <span className="ui-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon = "spark",
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <span className="ui-empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`ui-alert ui-alert-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={tone === "success" ? "check" : tone === "danger" ? "close" : "shield"} size={16} />
      <div>
        {title && <b>{title}</b>}
        {children && <span>{children}</span>}
      </div>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="ui-skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

// Transient confirmation or error message anchored to the bottom of the screen.
export function useToast() {
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string, error = false) => {
    setToast({ text, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), error ? 8000 : 4000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = toast ? (
    <div className={`ui-toast${toast.error ? " error" : ""}`} role={toast.error ? "alert" : "status"}>
      <Icon name={toast.error ? "close" : "check"} size={16} />
      <span>{toast.text}</span>
      <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  ) : null;
  return { show, node };
}

// Readable durations for minute values ("1 day", "2 hours", "30 minutes").
export function duration(minutes: number) {
  if (!minutes) return "None";
  if (minutes % 10080 === 0) return plural(minutes / 10080, "week");
  if (minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return plural(minutes, "minute");
}
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

export function formatDateTime(value: string | Date) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
};
// In-app replacement for window.confirm: `if (await confirm({...})) …`.
export function useConfirm() {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const node = pending ? (
    <ConfirmDialog {...pending} onClose={close} />
  ) : null;
  return { confirm, node };
}

function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  danger,
  onClose,
}: ConfirmOptions & { onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal ui-confirm"
      aria-labelledby="ui-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
    >
      <h2 id="ui-confirm-title">{title}</h2>
      {body && <div className="ui-confirm-body">{body}</div>}
      <div className="ui-modal-actions">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={() => onClose(false)}>
          Cancel
        </button>
        <button
          type="button"
          autoFocus
          className={`ui-btn ${danger ? "ui-btn-danger" : "ui-btn-primary"}`}
          onClick={() => onClose(true)}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ui-copy">
      <input readOnly value={value} aria-label={label} className="ui-input" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="ui-btn ui-btn-secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {}
        }}
      >
        <Icon name={copied ? "check" : "link"} size={14} /> {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="ui-meter" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <span style={{ width: `${pct}%` }} className={pct >= 100 ? "full" : ""} />
    </div>
  );
}

export function slugify(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
