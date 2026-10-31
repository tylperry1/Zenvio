"use client";
// Zenvio design system primitives. Styles live in src/app/design-system.css;
// usage and rules are documented in DESIGN_SYSTEM.md.
import type { ReactNode } from "react";
import { Icon } from "./icons";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="ds-page-header">
      <div>
        {eyebrow && <p className="ds-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="ds-page-description">{description}</p>}
      </div>
      {actions && <div className="ds-page-actions">{actions}</div>}
    </div>
  );
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export function Badge({ tone = "neutral", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`ds-badge ${tone}`}>
      {dot && <i aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Kpi({
  label,
  value,
  detail,
  icon,
  tone,
  loading,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: string;
  tone?: Tone;
  loading?: boolean;
}) {
  return (
    <article className={`ds-kpi ${tone || ""}`}>
      <div className="ds-kpi-top">
        <span>{label}</span>
        {icon && <Icon name={icon} size={16} />}
      </div>
      {loading ? <Skeleton width="60%" height={30} /> : <strong>{value}</strong>}
      {detail && <p>{detail}</p>}
    </article>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  flush,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`ds-panel ${flush ? "flush" : ""} ${className}`}>
      {(title || actions) && (
        <header className="ds-panel-header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="ds-panel-actions">{actions}</div>}
        </header>
      )}
      <div className="ds-panel-body">{children}</div>
    </section>
  );
}

export function Skeleton({ width = "100%", height = 14 }: { width?: number | string; height?: number }) {
  return <span className="ds-skeleton" style={{ width, height }} aria-hidden="true" />;
}

export function EmptyState({
  icon = "search",
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
    <div className="ds-empty">
      <span className="ds-empty-icon">
        <Icon name={icon} size={20} />
      </span>
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="ds-search">
      <Icon name="search" size={15} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search">
          <Icon name="close" size={13} />
        </button>
      )}
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="ds-segmented" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="ds-pagination">
      <span>
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div>
        <button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button type="button" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

/** Accessible bar chart: bars are decorative; a data table is provided for assistive tech. */
export function BarChart({
  data,
  label,
  format = (n) => n.toLocaleString(),
}: {
  data: { label: string; value: number }[];
  label: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = Math.max(1, Math.ceil(data.length / 8));
  return (
    <figure className="ds-chart" aria-label={label}>
      <div className="ds-chart-bars" aria-hidden="true">
        {data.map((d, i) => (
          <div key={d.label + i} className="ds-chart-col" title={`${d.label}: ${format(d.value)}`}>
            <i style={{ height: `${(d.value / max) * 100}%` }} className={d.value ? "" : "zero"} />
            <small>{i % step === 0 ? d.label : ""}</small>
          </div>
        ))}
      </div>
      <div className="ds-visually-hidden">
      <table>
        <caption>{label}</caption>
        <tbody>
          {data.map((d, i) => (
            <tr key={d.label + i}>
              <th scope="row">{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}

export function Distribution({ items }: { items: { label: string; value: number; tone?: string }[] }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <div className="ds-distribution">
      <div className="ds-distribution-bar" aria-hidden="true">
        {items.map((i) =>
          i.value ? <i key={i.label} style={{ width: `${(i.value / total) * 100}%`, background: i.tone }} /> : null,
        )}
      </div>
      <ul>
        {items.map((i) => (
          <li key={i.label}>
            <span className="ds-swatch" style={{ background: i.tone }} aria-hidden="true" />
            <span>{i.label}</span>
            <b>{i.value.toLocaleString()}</b>
            <small>{Math.round((i.value / total) * 100)}%</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Timeline({
  items,
}: {
  items: { id: string; title: ReactNode; meta?: ReactNode; detail?: ReactNode; icon?: string; tone?: Tone }[];
}) {
  return (
    <ol className="ds-timeline">
      {items.map((i) => (
        <li key={i.id}>
          <span className={`ds-timeline-icon ${i.tone || ""}`} aria-hidden="true">
            <Icon name={i.icon || "clock"} size={13} />
          </span>
          <div>
            <b>{i.title}</b>
            {i.detail && <p>{i.detail}</p>}
            {i.meta && <small>{i.meta}</small>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={`ds-notice ${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={tone === "success" ? "check" : tone === "danger" || tone === "warning" ? "shield" : "bell"} size={15} />
      <div>{children}</div>
    </div>
  );
}

export const formatDate = (s?: string | null, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) =>
  s ? new Date(s).toLocaleString(undefined, opts) : "—";
export function relativeTime(s?: string | null) {
  if (!s) return "Never";
  const diff = Date.now() - +new Date(s);
  const m = Math.round(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(s).toLocaleDateString(undefined, { dateStyle: "medium" });
}
export const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
