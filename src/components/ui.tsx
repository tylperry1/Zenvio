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
