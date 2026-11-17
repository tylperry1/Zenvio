"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { BillingCatalog } from "@/lib/billing-catalog";
import { money } from "@/lib/billing-types";
import { formatAllowance } from "@/lib/allowance-display";
import {
  Badge,
  CurrencyField,
  EmptyState,
  Field,
  FormActions,
  Kpi,
  Notice,
  PageHeader,
  Panel,
  Segmented,
  Skeleton,
  Timeline,
  formatDate,
  relativeTime,
  usd,
} from "./ds";
import { Icon } from "./icons";

type Version = {
  id: string;
  state: string;
  catalog?: BillingCatalog;
  created_at?: string;
  published_at?: string | null;
  created_by?: string | null;
};
type Operation = {
  id: string;
  action: string;
  state: string;
  result?: { code?: string; promotion?: string; version?: string; message?: string };
  error?: string | null;
  updated_at?: string;
};
type Preview = {
  id: string;
  reason: string;
  userId: string;
  plan: string;
  seats: number;
  amountDue: number;
  currency: string;
};

type Meter = keyof BillingCatalog["allowances"]["individual"];

const OFFER_COPY: Record<string, { title: string; blurb: string }> = {
  individual: { title: "Professional plan", blurb: "Everything a single host needs" },
  team: { title: "Teams plan", blurb: "Shared scheduling for 3 or more hosts" },
  team_extra: { title: "Additional team seat", blurb: "Per seat beyond the included three" },
};

const ALLOWANCE_GROUPS: {
  id: string;
  title: string;
  meters: { key: Meter; label: string; hint: string; unit?: "bytes" | "minutes" }[];
}[] = [
  {
    id: "communications",
    title: "Communications",
    meters: [{ key: "emails", label: "Transactional emails", hint: "Per month" }],
  },
  {
    id: "ai",
    title: "AI usage",
    meters: [{ key: "aiCredits", label: "AI credits", hint: "Per month" }],
  },
  {
    id: "documents",
    title: "Documents and signatures",
    meters: [{ key: "envelopes", label: "Signing envelopes", hint: "Per month" }],
  },
  {
    id: "video",
    title: "Video",
    meters: [
      {
        key: "videoMinutes",
        label: "Video participant-minutes",
        hint: "Shown as participant-hours when divisible by 60",
        unit: "minutes",
      },
    ],
  },
  {
    id: "storage",
    title: "Storage",
    meters: [
      {
        key: "storageBytes",
        label: "Private storage",
        hint: "Enter gigabytes; stored as exact bytes",
        unit: "bytes",
      },
    ],
  },
];

function videoHint(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 participant-minutes";
  if (minutes % 60 === 0) return `${(minutes / 60).toLocaleString()} participant-hours`;
  return `${minutes.toLocaleString()} participant-minutes`;
}

function storageGb(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  return String(bytes / 1_000_000_000);
}

function opTone(state: string): "success" | "warning" | "danger" | "neutral" | "info" {
  if (state === "succeeded") return "success";
  if (state === "pending") return "warning";
  if (state === "failed") return "danger";
  return "neutral";
}

export function AdminBillingCenter() {
  const params = useSearchParams();
  const [data, setData] = useState<{ versions: Version[]; operations: Operation[]; catalog: BillingCatalog } | null>(null);
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [last, setLast] = useState<Record<string, unknown> | null>(null);
  const [planTab, setPlanTab] = useState<"individual" | "team">("individual");
  const [section, setSection] = useState<"pricing" | "coupons" | "seats" | "audit">(
    params.get("userId") ? "seats" : "pricing",
  );

  async function load() {
    const r = await fetch("/api/admin/billing", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
    setCatalog((c) => c || d.catalog);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);

  async function send(input: Record<string, unknown>, retry = false) {
    const request = retry ? input : { ...input, operationId: crypto.randomUUID() };
    setLast(request);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setLast(null);
      setMessage(d.message || "Billing operation completed.");
      if (input.action === "preview") {
        setPreview({ ...d, id: String(request.operationId), reason: String(request.reason) });
      }
      await load();
      return d;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const published = useMemo(() => data?.versions.find((v) => v.state === "published") || null, [data]);
  const drafts = useMemo(() => data?.versions.filter((v) => v.state === "draft") || [], [data]);
  const coupons = useMemo(
    () => data?.operations.filter((o) => o.action === "coupon" && o.state === "succeeded") || [],
    [data],
  );
  const recentOps = useMemo(() => data?.operations || [], [data]);
  const failedOps = useMemo(() => data?.operations.filter((o) => o.state === "failed").length || 0, [data]);

  if (error && !data) {
    return (
      <div className="ds-root bc">
        <Notice tone="danger">{error}</Notice>
      </div>
    );
  }

  if (!data || !catalog) {
    return (
      <div className="ds-root bc">
        <div className="ds-kpis">
          {[0, 1, 2, 3].map((i) => (
            <Kpi key={i} label="Loading" value="" loading />
          ))}
        </div>
        <Panel title="Loading billing operations">
          <Skeleton height={120} />
        </Panel>
      </div>
    );
  }

  function setOfferMonthly(id: string, monthly: number) {
    setCatalog((c) =>
      c
        ? {
            ...c,
            offers: c.offers.map((o) => (o.id === id ? { ...o, monthly } : o)),
          }
        : c,
    );
  }

  function setAllowance(plan: "individual" | "team", meter: Meter, value: number) {
    setCatalog((c) =>
      c
        ? {
            ...c,
            allowances: {
              ...c.allowances,
              [plan]: { ...c.allowances[plan], [meter]: value },
            },
          }
        : c,
    );
  }

  return (
    <div className="ds-root bc">
      <PageHeader
        eyebrow="Billing operations"
        title="Billing & revenue"
        description="Draft and publish catalog prices for new enrollments. Existing customers keep contracted prices until an explicit, previewed change. Live Stripe mutations require sandbox acceptance."
        actions={
          <Link className="ds-btn" href="/admin/operations?section=subscriptions">
            Open subscriptions
          </Link>
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      {last && error && (
        <FormActions>
          <button type="button" className="ds-btn" disabled={busy} onClick={() => void send(last, true)}>
            Retry the same operation
          </button>
        </FormActions>
      )}

      <div className="ds-kpis">
        <Kpi
          label="Published catalog"
          icon="layers"
          value={published ? published.id.slice(0, 8) : "None"}
          detail={published?.published_at ? `Published ${relativeTime(published.published_at)}` : "No active catalog version"}
        />
        <Kpi
          label="Draft versions"
          icon="file"
          value={drafts.length}
          tone={drafts.length ? "info" : "neutral"}
          detail={drafts.length ? "Ready to review and publish" : "Save a draft to start a change"}
        />
        <Kpi
          label="Promo creations"
          icon="spark"
          value={coupons.length}
          detail="Successful coupon-create operations (not live code status)"
        />
        <Kpi
          label="Failed operations"
          icon="shield"
          value={failedOps}
          tone={failedOps ? "danger" : "success"}
          detail={failedOps ? "Review audit and retry with the same id" : "No recent failures"}
        />
      </div>

      <div className="bc-nav">
        <Segmented
          label="Billing sections"
          value={section}
          onChange={(next) => {
            // Drop stale proration previews when leaving Seats; the form remounts uncontrolled.
            if (next !== "seats") setPreview(null);
            setSection(next);
          }}
          options={[
            ["pricing", "Pricing & allowances"],
            ["coupons", "Coupons"],
            ["seats", "Seats & proration"],
            ["audit", "Sync & audit"],
          ]}
        />
      </div>

      {section === "pricing" && (
        <div className="ds-stack">
          <Panel
            title="Current published prices"
            description="Values come from the live catalog. Editing below creates a draft only — publishing is a separate, gated step."
          >
            <div className="bc-packages">
              {data.catalog.offers.map((o) => {
                const copy = OFFER_COPY[o.id] || { title: o.name, blurb: o.name };
                return (
                  <article key={o.id} className={`bc-package${o.id === "team" ? " featured" : ""}`}>
                    <header>
                      <div>
                        <h3>{copy.title}</h3>
                        <p>{copy.blurb}</p>
                      </div>
                      <Badge tone="info" dot>
                        Published
                      </Badge>
                    </header>
                    <div className="bc-price">
                      <strong>{usd(o.monthly)}</strong>
                      <span>/ month{o.seats > 1 ? ` · ${o.seats} seats included` : ""}</span>
                    </div>
                    <dl className="ds-dl">
                      <div>
                        <dt>Catalog offer</dt>
                        <dd>{o.name}</dd>
                      </div>
                      <div>
                        <dt>Internal id</dt>
                        <dd>
                          <code>{o.id}</code>
                        </dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </Panel>

          <Panel
            title="Draft pricing"
            description="Enter customer-facing dollar amounts. Cents conversion stays internal. Saving creates a draft version for review."
          >
            <form
              className="bc-form"
              onSubmit={(e) => {
                e.preventDefault();
                const reason = new FormData(e.currentTarget).get("reason");
                void send({ action: "draft", catalog, reason });
              }}
            >
              <div className="bc-packages">
                {catalog.offers.map((o) => {
                  const copy = OFFER_COPY[o.id] || { title: o.name, blurb: o.name };
                  return (
                    <article key={o.id} className="bc-package edit">
                      <header>
                        <div>
                          <h3>{copy.title}</h3>
                          <p>{copy.blurb}</p>
                        </div>
                        <Badge tone="neutral">Draft</Badge>
                      </header>
                      <CurrencyField
                        id={`bc-price-${o.id}`}
                        label={`${copy.title} — monthly`}
                        hint={`Stored as ${Number.isFinite(o.monthly) ? o.monthly : "—"} USD cents`}
                        cents={o.monthly}
                        onCentsChange={(cents) => setOfferMonthly(o.id, cents)}
                        required
                      />
                    </article>
                  );
                })}
              </div>

              <div className="bc-allowance-head">
                <div>
                  <h3>Usage allowances</h3>
                  <p>Grouped by category. Storage uses GB in the UI; video shows participant-hours when exact.</p>
                </div>
                <Segmented
                  label="Allowance plan"
                  value={planTab}
                  onChange={setPlanTab}
                  options={[
                    ["individual", "Individual"],
                    ["team", "Teams shared"],
                  ]}
                />
              </div>

              <div className="bc-allowance-grid">
                {ALLOWANCE_GROUPS.map((group) => (
                  <section key={group.id} className="bc-allowance-card">
                    <h4>{group.title}</h4>
                    {group.meters.map((m) => {
                      const value = catalog.allowances[planTab][m.key];
                      if (m.unit === "bytes") {
                        return (
                          <Field
                            key={m.key}
                            label={m.label}
                            hint={`${formatAllowance(value, { meter: "storageBytes" })} exact · ${m.hint}`}
                            htmlFor={`bc-${planTab}-${m.key}`}
                          >
                            <input
                              id={`bc-${planTab}-${m.key}`}
                              className="bc-input"
                              type="number"
                              min={0}
                              step="any"
                              required
                              value={storageGb(value)}
                              onChange={(e) => {
                                const gb = Number(e.target.value);
                                if (!Number.isFinite(gb) || gb < 0) return;
                                setAllowance(planTab, m.key, Math.round(gb * 1_000_000_000));
                              }}
                            />
                          </Field>
                        );
                      }
                      return (
                        <Field
                          key={m.key}
                          label={m.label}
                          hint={m.unit === "minutes" ? videoHint(value) : m.hint}
                          htmlFor={`bc-${planTab}-${m.key}`}
                        >
                          <input
                            id={`bc-${planTab}-${m.key}`}
                            className="bc-input"
                            type="number"
                            min={0}
                            max={1_000_000_000}
                            required
                            value={value}
                            onChange={(e) => setAllowance(planTab, m.key, Number(e.target.value))}
                          />
                        </Field>
                      );
                    })}
                    {group.id === "storage" && (
                      <p className="bc-muted">
                        Team capacity is managed through seats on the Teams plan and seat proration tools — not a separate meter here.
                      </p>
                    )}
                  </section>
                ))}
              </div>

              <Field label="Reason for draft" hint="Required for the audit trail (at least 5 characters)." htmlFor="bc-draft-reason">
                <input id="bc-draft-reason" name="reason" required minLength={5} maxLength={500} className="bc-input" />
              </Field>
              <FormActions>
                <button type="submit" className="ds-btn primary" disabled={busy}>
                  {busy ? "Saving…" : "Save draft"}
                </button>
              </FormActions>
            </form>
          </Panel>

          <Panel title="Versions" description="Publish only after review. Publishing affects new enrollments; existing subscriptions stay on their contracted prices.">
            {!data.versions.length ? (
              <EmptyState icon="layers" title="No catalog versions yet">
                Save a draft to create the first version.
              </EmptyState>
            ) : (
              <ul className="bc-versions">
                {data.versions.map((v) => (
                  <li key={v.id}>
                    <div>
                      <b>
                        <code>{v.id}</code>
                      </b>
                      <small>
                        {v.state}
                        {v.created_at ? ` · ${formatDate(v.created_at, { dateStyle: "medium", timeStyle: "short" })}` : ""}
                        {v.published_at ? ` · published ${formatDate(v.published_at, { dateStyle: "medium", timeStyle: "short" })}` : ""}
                      </small>
                    </div>
                    <Badge tone={v.state === "published" ? "success" : v.state === "draft" ? "info" : "neutral"} dot>
                      {v.state}
                    </Badge>
                    {v.state === "draft" && (
                      <button
                        type="button"
                        className="ds-btn sm primary"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Publish this version for new enrollments only? Existing subscriptions remain unchanged. Stripe sandbox acceptance is required.",
                            )
                          ) {
                            void send({
                              action: "publish",
                              draftId: v.id,
                              reason: "Publish approved draft for new enrollments",
                            });
                          }
                        }}
                      >
                        Publish draft
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {section === "coupons" && (
        <div className="ds-grid-2">
          <Panel title="Create promotion code" description="Percent-off codes apply to Individual and Teams products. Stripe mutations require sandbox acceptance.">
            <form
              className="bc-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void send({
                  action: "coupon",
                  code: f.get("code"),
                  percent: Number(f.get("percent")),
                  months: Number(f.get("months")),
                  maxRedemptions: Number(f.get("limit")),
                  reason: f.get("reason"),
                });
              }}
            >
              <div className="bc-form-grid">
                <Field label="Promotion code" htmlFor="bc-code">
                  <input id="bc-code" name="code" className="bc-input" required pattern="[A-Za-z0-9_-]+" minLength={3} maxLength={40} />
                </Field>
                <Field label="Discount percent" htmlFor="bc-percent">
                  <input id="bc-percent" name="percent" className="bc-input" type="number" min={1} max={100} defaultValue={50} required />
                </Field>
                <Field label="Duration in months" htmlFor="bc-months">
                  <input id="bc-months" name="months" className="bc-input" type="number" min={1} max={24} defaultValue={3} required />
                </Field>
                <Field label="Maximum redemptions" htmlFor="bc-limit">
                  <input id="bc-limit" name="limit" className="bc-input" type="number" min={1} max={100000} defaultValue={100} required />
                </Field>
              </div>
              <Field label="Reason" htmlFor="bc-coupon-reason">
                <input id="bc-coupon-reason" name="reason" className="bc-input" minLength={5} maxLength={500} required />
              </Field>
              <FormActions>
                <button type="submit" className="ds-btn primary" disabled={busy}>
                  Create promotion
                </button>
              </FormActions>
            </form>
          </Panel>
          <Panel title="Managed promotions" description="Only promotions created here can be paused or resumed.">
            {!coupons.length ? (
              <EmptyState icon="spark" title="No promotions yet">
                Create a code to manage pause and resume from this panel.
              </EmptyState>
            ) : (
              <ul className="bc-versions">
                {coupons.map((o) => (
                  <li key={o.id}>
                    <div>
                      <b>{o.result?.code}</b>
                      <small>{o.id}</small>
                    </div>
                    <button
                      type="button"
                      className="ds-btn sm"
                      disabled={busy}
                      onClick={() =>
                        void send({
                          action: "promotion-status",
                          promotionId: o.result?.promotion,
                          active: false,
                          reason: "Pause promotion redemptions",
                        })
                      }
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      className="ds-btn sm"
                      disabled={busy}
                      onClick={() =>
                        void send({
                          action: "promotion-status",
                          promotionId: o.result?.promotion,
                          active: true,
                          reason: "Resume promotion redemptions",
                        })
                      }
                    >
                      Resume
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {section === "seats" && (
        <div className="ds-stack">
          <Panel
            title="Customer subscription & seats"
            description={
              <>
                Cancellation and resumption remain in{" "}
                <Link href="/admin/operations?section=subscriptions">Subscriptions</Link>. Package and seat changes require a fresh proration preview.
              </>
            }
          >
            <form
              className="bc-form"
              onSubmit={(e) => {
                e.preventDefault();
                setPreview(null);
                const f = new FormData(e.currentTarget);
                void send({
                  action: "preview",
                  userId: f.get("userId"),
                  plan: f.get("plan"),
                  seats: Number(f.get("seats")),
                  reason: f.get("reason"),
                });
              }}
            >
              <div className="bc-form-grid">
                <Field label="Account identifier" htmlFor="bc-user">
                  <input
                    id="bc-user"
                    name="userId"
                    className="bc-input"
                    defaultValue={params.get("userId") || ""}
                    required
                  />
                </Field>
                <Field label="Plan" htmlFor="bc-plan">
                  <select id="bc-plan" name="plan" className="bc-input" defaultValue="individual">
                    <option value="individual">Individual</option>
                    <option value="team">Teams</option>
                  </select>
                </Field>
                <Field label="Total seats" htmlFor="bc-seats" hint="Teams require at least 3 seats.">
                  <input id="bc-seats" name="seats" className="bc-input" type="number" min={1} max={1000} defaultValue={3} required />
                </Field>
              </div>
              <Field label="Reason" htmlFor="bc-seat-reason">
                <input id="bc-seat-reason" name="reason" className="bc-input" required minLength={5} maxLength={500} />
              </Field>
              <FormActions>
                <button type="submit" className="ds-btn primary" disabled={busy}>
                  Preview proration
                </button>
              </FormActions>
            </form>
          </Panel>

          {preview && (
            <Panel title="Review Stripe preview" description="Valid for five minutes. Any change to the subscription requires another preview.">
              <div className="bc-preview">
                <p>
                  <Badge tone="info">{preview.plan}</Badge> · {preview.seats} seats · Amount due:{" "}
                  <b>
                    {money(preview.amountDue)} {preview.currency.toUpperCase()}
                  </b>
                </p>
                <FormActions>
                  <button
                    type="button"
                    className="ds-btn primary"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Confirm this package, seat count and prorated amount?")) {
                        void send({
                          action: "change",
                          userId: preview.userId,
                          previewId: preview.id,
                          amountDue: preview.amountDue,
                          confirm: true,
                          reason: preview.reason,
                        });
                      }
                    }}
                  >
                    Confirm previewed change
                  </button>
                </FormActions>
              </div>
            </Panel>
          )}
        </div>
      )}

      {section === "audit" && (
        <div className="ds-grid-2">
          <Panel title="Sync status & financial audit" description="Provider failures stay visible. Retry the same operation to preserve idempotency.">
            {!recentOps.length ? (
              <EmptyState icon="clock" title="No billing operations yet" />
            ) : (
              <Timeline
                items={recentOps.map((o) => ({
                  id: o.id,
                  title: (
                    <>
                      {o.action} · <Badge tone={opTone(o.state)}>{o.state}</Badge>
                    </>
                  ),
                  detail: o.error || o.result?.message || o.result?.code || o.result?.version || undefined,
                  meta: (
                    <>
                      <code>{o.id}</code>
                      {o.updated_at ? ` · ${formatDate(o.updated_at, { dateStyle: "medium", timeStyle: "short" })}` : ""}
                    </>
                  ),
                  icon: o.state === "failed" ? "shield" : o.state === "succeeded" ? "check" : "clock",
                  tone: opTone(o.state),
                }))}
              />
            )}
          </Panel>
          <Panel title="Safeguards" description="Production prices are never changed by this UI alone.">
            <ul className="bc-safeguards">
              <li>
                <Icon name="shield" size={16} />
                <div>
                  <b>Sandbox acceptance gate</b>
                  <p>Publish, coupon, and subscription mutations require Stripe sandbox lifecycle acceptance.</p>
                </div>
              </li>
              <li>
                <Icon name="layers" size={16} />
                <div>
                  <b>Draft → publish</b>
                  <p>Catalog edits save as drafts. Publishing is explicit and only affects new enrollments.</p>
                </div>
              </li>
              <li>
                <Icon name="users" size={16} />
                <div>
                  <b>Existing contracts preserved</b>
                  <p>Seat and package changes require a fresh Stripe proration preview and confirmation.</p>
                </div>
              </li>
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}
