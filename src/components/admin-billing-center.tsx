"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { BillingCatalog } from "@/lib/billing-catalog";
import type { CatalogSyncReport } from "@/lib/pricing-sync";
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
  type CouponRow = {
    id: string;
    code: string;
    name?: string;
    discount_type: string;
    percent_off?: number | null;
    amount_off_cents?: number | null;
    duration: string;
    duration_in_months?: number | null;
    max_redemptions?: number | null;
    active: boolean;
    sync_status: string;
    sync_error?: string | null;
    stripe_coupon_id?: string | null;
    stripe_promotion_code_id?: string | null;
    catalog_targets?: string[];
    updated_at?: string;
  };
  type AddonRow = {
    id: string;
    name: string;
    amount_cents: number;
    quantity: number | string;
    unit: string;
    recurring: boolean;
    available: boolean;
    catalog_targets?: string[];
    stripe_product_id?: string | null;
    stripe_price_id?: string | null;
    sync_status: string;
    sync_error?: string | null;
    updated_at?: string;
  };
  const [data, setData] = useState<{
    versions: Version[];
    operations: Operation[];
    catalog: BillingCatalog;
    coupons?: CouponRow[];
    addons?: AddonRow[];
    sync?: CatalogSyncReport;
    publicSurface?: {
      family: string;
      previewOnly: boolean;
      displayVersion: string;
      enrollment: { enabled: boolean; catalogVersion: string; plans: string[] };
    };
  } | null>(null);
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [last, setLast] = useState<Record<string, unknown> | null>(null);
  const [planTab, setPlanTab] = useState<"individual" | "team">("individual");
  const [section, setSection] = useState<"pricing" | "coupons" | "addons" | "seats" | "audit">(
    params.get("userId") ? "seats" : "pricing",
  );
  const [addonDrafts, setAddonDrafts] = useState<Record<string, { name: string; amount: string; available: boolean }>>(
    {},
  );
  // Bumped when leaving Seats (or starting a newer preview) so stale send() completions cannot restore preview.
  const seatsPreviewGen = useRef(0);

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
    if (input.action === "preview") seatsPreviewGen.current += 1;
    const previewGen = seatsPreviewGen.current;
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
      if (input.action === "preview" && previewGen === seatsPreviewGen.current) {
        setPreview({ ...d, id: String(request.operationId), reason: String(request.reason) });
      }
      await load();
      return d;
    } catch (e) {
      setError((e as Error).message);
      // Refresh after failed coupon sync so Retry sync / legacy controls appear without a full reload.
      if (String(input.action).startsWith("coupon") || String(input.action).startsWith("addon")) {
        try {
          await load();
        } catch {
          /* keep original error */
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const published = useMemo(() => data?.versions.find((v) => v.state === "published") || null, [data]);
  const drafts = useMemo(() => data?.versions.filter((v) => v.state === "draft") || [], [data]);
  const coupons = useMemo(() => data?.coupons || [], [data]);
  const addons = useMemo(() => data?.addons || [], [data]);
  const legacyCouponOps = useMemo(
    () => data?.operations.filter((o) => o.action === "coupon" && o.state === "succeeded") || [],
    [data],
  );
  const recentOps = useMemo(() => data?.operations || [], [data]);
  const failedOps = useMemo(() => data?.operations.filter((o) => o.state === "failed").length || 0, [data]);

  useEffect(() => {
    if (!addons.length) return;
    setAddonDrafts((prev) => {
      const next = { ...prev };
      for (const a of addons) {
        if (!next[a.id]) {
          next[a.id] = {
            name: a.name,
            amount: (a.amount_cents / 100).toFixed(2),
            available: a.available,
          };
        }
      }
      return next;
    });
  }, [addons]);

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
          label="Promotion codes"
          icon="spark"
          value={coupons.length || legacyCouponOps.length}
          detail={
            coupons.some((c) => c.sync_status === "failed")
              ? "Includes failed Stripe sync — open Coupons to retry"
              : "Durable coupon catalog with Stripe sync status"
          }
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
            // Drop stale proration previews when leaving Seats; invalidate in-flight preview sends.
            if (next !== "seats") {
              seatsPreviewGen.current += 1;
              setPreview(null);
            }
            setSection(next);
          }}
          options={[
            ["pricing", "Pricing & allowances"],
            ["coupons", "Coupons"],
            ["addons", "Add-ons"],
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
                              "Publish this version for new enrollments only? This creates NEW Stripe prices. Existing subscriber prices are never rewritten. Stripe sandbox acceptance is required.",
                            )
                          ) {
                            void send({
                              action: "publish",
                              draftId: v.id,
                              confirmLiveStripe: true,
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

      {section === "addons" && (
        <div className="ds-stack">
          <Panel
            title="Add-on catalog"
            description="Approved retail amounts are stored locally and synchronized to Stripe as Products + Prices. Purchase stays off until ADDON_BILLING_VALIDATED and each row is marked available. Recurring SMS/storage and seat add-ons remain unpublished until fulfillment acceptance."
          >
            <FormActions>
              <button
                type="button"
                className="ds-btn primary"
                disabled={busy}
                onClick={() =>
                  void send({
                    action: "addon-sync-all",
                    confirmStripeSync: true,
                    reason: "Sync all platform add-ons to Stripe products and prices",
                  })
                }
              >
                Sync all to Stripe
              </button>
            </FormActions>
            {!addons.length ? (
              <EmptyState icon="spark" title="No add-ons seeded">
                Apply migration 094 to seed the approved add-on catalog.
              </EmptyState>
            ) : (
              <ul className="bc-versions">
                {addons.map((a) => {
                  const draft = addonDrafts[a.id] || {
                    name: a.name,
                    amount: (a.amount_cents / 100).toFixed(2),
                    available: a.available,
                  };
                  return (
                    <li key={a.id}>
                      <div>
                        <b>{a.id}</b>
                        <small>
                          {a.quantity} {a.unit}
                          {a.recurring ? " · monthly" : " · one-time"}
                          {(a.catalog_targets || []).length
                            ? ` · ${(a.catalog_targets || []).join("+")}`
                            : ""}
                        </small>
                        <Badge
                          tone={
                            a.sync_status === "synced"
                              ? "success"
                              : a.sync_status === "failed"
                                ? "danger"
                                : "warning"
                          }
                          dot
                        >
                          {a.sync_status}
                        </Badge>
                        {a.stripe_price_id ? <small>{a.stripe_price_id}</small> : null}
                        {a.sync_error ? <small>{a.sync_error}</small> : null}
                      </div>
                      <div className="bc-form-grid">
                        <Field label="Display name" htmlFor={`addon-name-${a.id}`}>
                          <input
                            id={`addon-name-${a.id}`}
                            className="bc-input"
                            value={draft.name}
                            onChange={(e) =>
                              setAddonDrafts((d) => ({
                                ...d,
                                [a.id]: { ...draft, name: e.target.value },
                              }))
                            }
                          />
                        </Field>
                        <Field label="Amount (USD)" htmlFor={`addon-amt-${a.id}`}>
                          <input
                            id={`addon-amt-${a.id}`}
                            className="bc-input"
                            type="number"
                            min={0}
                            step="0.01"
                            value={draft.amount}
                            onChange={(e) =>
                              setAddonDrafts((d) => ({
                                ...d,
                                [a.id]: { ...draft, amount: e.target.value },
                              }))
                            }
                          />
                        </Field>
                        <label>
                          <input
                            type="checkbox"
                            checked={draft.available}
                            onChange={(e) =>
                              setAddonDrafts((d) => ({
                                ...d,
                                [a.id]: { ...draft, available: e.target.checked },
                              }))
                            }
                          />{" "}
                          Available (local; still needs ADDON_BILLING_VALIDATED)
                        </label>
                      </div>
                      <FormActions>
                        <button
                          type="button"
                          className="ds-btn sm"
                          disabled={busy}
                          onClick={() =>
                            void send({
                              action: "addon-update",
                              addonId: a.id,
                              name: draft.name,
                              amountCents: Math.round(Number(draft.amount) * 100),
                              available: draft.available,
                              reason: `Update add-on ${a.id} catalog fields`,
                            }).then((result) => {
                              // send() resolves undefined on failure — keep the draft so edits are not lost.
                              if (!result) return;
                              setAddonDrafts((d) => {
                                const n = { ...d };
                                delete n[a.id];
                                return n;
                              });
                            })
                          }
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="ds-btn sm"
                          disabled={busy}
                          onClick={() =>
                            void send({
                              action: "addon-sync",
                              addonId: a.id,
                              reason: `Sync add-on ${a.id} to Stripe`,
                            })
                          }
                        >
                          Sync to Stripe
                        </button>
                      </FormActions>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {section === "coupons" && (
        <div className="ds-grid-2">
          <Panel
            title="Create promotion code"
            description="Saved locally first, then synchronized to Stripe as a coupon + promotion code. Success requires both Stripe objects. Sandbox acceptance is required."
          >
            <form
              className="bc-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const discountType = String(f.get("discountType") || "percent");
                const duration = String(f.get("duration") || "repeating");
                const targets = [
                  f.get("targetV3") === "on" ? "v3" : null,
                  f.get("targetV4") === "on" ? "v4" : null,
                ].filter(Boolean);
                void send({
                  action: "coupon",
                  code: f.get("code"),
                  name: f.get("name") || f.get("code"),
                  discountType,
                  percent: discountType === "percent" ? Number(f.get("percent")) : undefined,
                  amountOffCents:
                    discountType === "amount" ? Math.round(Number(f.get("amount")) * 100) : undefined,
                  duration,
                  durationInMonths: duration === "repeating" ? Number(f.get("months")) : undefined,
                  maxRedemptions: Number(f.get("limit")) || undefined,
                  redeemBy: (() => {
                    const raw = String(f.get("expires") || "").trim();
                    if (!raw) return undefined;
                    // datetime-local has no zone; convert the selected local instant to ISO with offset.
                    const local = new Date(raw);
                    return Number.isFinite(local.getTime()) ? local.toISOString() : raw;
                  })(),
                  firstTimeTransaction: f.get("firstTime") === "on",
                  catalogTargets: targets.length ? targets : ["v3"],
                  reason: f.get("reason"),
                });
              }}
            >
              <div className="bc-form-grid">
                <Field label="Promotion code" htmlFor="bc-code">
                  <input id="bc-code" name="code" className="bc-input" required pattern="[A-Za-z0-9-]+" minLength={3} maxLength={40} title="Letters, digits, and dashes only" />
                </Field>
                <Field label="Display name" htmlFor="bc-name">
                  <input id="bc-name" name="name" className="bc-input" maxLength={120} />
                </Field>
                <Field label="Discount type" htmlFor="bc-dtype">
                  <select id="bc-dtype" name="discountType" className="bc-input" defaultValue="percent">
                    <option value="percent">Percent off</option>
                    <option value="amount">Fixed amount (USD)</option>
                  </select>
                </Field>
                <Field label="Percent off" htmlFor="bc-percent">
                  <input id="bc-percent" name="percent" className="bc-input" type="number" min={1} max={100} defaultValue={50} />
                </Field>
                <Field label="Amount off (USD)" htmlFor="bc-amount">
                  <input id="bc-amount" name="amount" className="bc-input" type="number" min={0.01} step={0.01} placeholder="10.00" />
                </Field>
                <Field label="Duration" htmlFor="bc-duration">
                  <select id="bc-duration" name="duration" className="bc-input" defaultValue="repeating">
                    <option value="once">Once</option>
                    <option value="repeating">Repeating</option>
                    <option value="forever">Forever</option>
                  </select>
                </Field>
                <Field label="Duration in months" htmlFor="bc-months">
                  <input id="bc-months" name="months" className="bc-input" type="number" min={1} max={36} defaultValue={3} />
                </Field>
                <Field label="Maximum redemptions" htmlFor="bc-limit">
                  <input id="bc-limit" name="limit" className="bc-input" type="number" min={1} max={1000000} defaultValue={100} />
                </Field>
                <Field label="Expires (optional ISO)" htmlFor="bc-expires">
                  <input id="bc-expires" name="expires" className="bc-input" type="datetime-local" />
                </Field>
              </div>
              <div className="bc-form-grid" style={{ marginTop: 12 }}>
                <label>
                  <input type="checkbox" name="targetV3" defaultChecked /> Apply to v3 Individual/Teams
                </label>
                <label>
                  <input type="checkbox" name="targetV4" /> Apply to v4 Starter/Professional/Team
                </label>
                <label>
                  <input type="checkbox" name="firstTime" /> First-time customers only
                </label>
              </div>
              <Field label="Reason" htmlFor="bc-coupon-reason">
                <input id="bc-coupon-reason" name="reason" className="bc-input" minLength={5} maxLength={500} required />
              </Field>
              <FormActions>
                <button type="submit" className="ds-btn primary" disabled={busy}>
                  Create &amp; sync to Stripe
                </button>
              </FormActions>
            </form>
          </Panel>
          <Panel title="Coupon catalog" description="Sync status is authoritative. Failed rows were saved locally and can be retried — they never report success without Stripe IDs.">
            {!coupons.length ? (
              <EmptyState icon="spark" title="No coupons yet">
                Create a code to manage pause, resume, and Stripe retry from this panel.
              </EmptyState>
            ) : (
              <ul className="bc-versions">
                {coupons.map((c) => (
                  <li key={c.id}>
                    <div>
                      <b>{c.code}</b>
                      <small>
                        {c.discount_type === "percent"
                          ? `${c.percent_off}%`
                          : usd(c.amount_off_cents || 0)}{" "}
                        · {c.duration}
                        {c.duration_in_months ? ` ${c.duration_in_months}mo` : ""} ·{" "}
                        {(c.catalog_targets || []).join("+") || "v3"}
                      </small>
                      <Badge
                        tone={
                          c.sync_status === "synced"
                            ? "success"
                            : c.sync_status === "failed"
                              ? "danger"
                              : c.sync_status === "disabled"
                                ? "neutral"
                                : "warning"
                        }
                        dot
                      >
                        {c.sync_status}
                      </Badge>
                      {c.sync_error ? <small>{c.sync_error}</small> : null}
                    </div>
                    {c.sync_status === "failed" || c.sync_status === "pending" ? (
                      <button
                        type="button"
                        className="ds-btn sm"
                        disabled={busy}
                        onClick={() =>
                          void send({
                            action: "coupon-retry",
                            couponId: c.id,
                            reason: "Retry Stripe coupon synchronization",
                          })
                        }
                      >
                        Retry sync
                      </button>
                    ) : null}
                    {c.stripe_promotion_code_id ? (
                      <>
                        <button
                          type="button"
                          className="ds-btn sm"
                          disabled={busy || !c.active}
                          onClick={() =>
                            void send({
                              action: "promotion-status",
                              couponId: c.id,
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
                          disabled={busy || c.active}
                          onClick={() =>
                            void send({
                              action: "promotion-status",
                              couponId: c.id,
                              active: true,
                              reason: "Resume promotion redemptions",
                            })
                          }
                        >
                          Resume
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {legacyCouponOps.some((o) => o.result?.promotion) ? (
            <Panel
              title="Legacy promotions"
              description="Promotions created before the durable coupon catalog. Pause/resume still works via Stripe promotion id."
            >
              <ul className="bc-versions">
                {legacyCouponOps
                  .filter((o) => o.result?.promotion)
                  .filter(
                    (o) =>
                      !coupons.some(
                        (c) => c.stripe_promotion_code_id && c.stripe_promotion_code_id === o.result?.promotion,
                      ),
                  )
                  .map((o) => (
                    <li key={o.id}>
                      <div>
                        <b>{o.result?.code || o.result?.promotion}</b>
                        <small>{o.result?.promotion}</small>
                        <Badge tone="neutral" dot>
                          legacy
                        </Badge>
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
                            reason: "Pause legacy promotion redemptions",
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
                            reason: "Resume legacy promotion redemptions",
                          })
                        }
                      >
                        Resume
                      </button>
                    </li>
                  ))}
              </ul>
            </Panel>
          ) : null}
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
        <div className="ds-stack">
          <Panel
            title="Catalog ↔ Stripe mapping"
            description="Read-only sync status for the live published catalog and the proposed v4 catalog. This view never mutates Stripe."
          >
            {data.sync ? (
              <div className="ds-stack">
                <div className="ds-kpis">
                  <Kpi
                    label="Live synchronized"
                    value={data.sync.summary.liveSynchronized}
                    tone={data.sync.summary.liveMissing || data.sync.summary.liveMismatched ? "warning" : "success"}
                    detail={`Catalog ${data.sync.liveCatalogVersion}`}
                  />
                  <Kpi
                    label="Live gaps"
                    value={data.sync.summary.liveMissing + data.sync.summary.liveMismatched}
                    tone={data.sync.summary.liveMissing || data.sync.summary.liveMismatched ? "danger" : "success"}
                    detail="Missing or version-mismatched mappings"
                  />
                  <Kpi
                    label="v4 pending"
                    value={data.sync.summary.v4Pending}
                    tone="info"
                    detail={`Proposed ${data.sync.v4ProposedVersion} — provision only with approved test sync`}
                  />
                  <Kpi
                    label="Public surface"
                    value={data.publicSurface?.family?.toUpperCase() || "—"}
                    detail={
                      data.publicSurface?.previewOnly
                        ? `Preview ${data.publicSurface.displayVersion} (not enrollable)`
                        : `Enrollment ${data.publicSurface?.enrollment.enabled ? "open" : "gated"}`
                    }
                  />
                </div>
                <div className="bc-packages">
                  <section>
                    <h3>Live checkout mappings</h3>
                    <ul className="bc-versions">
                      {data.sync.live.map((row) => (
                        <li key={`${row.plan}-${row.period}`}>
                          <div>
                            <b>
                              {row.plan} · {row.period}
                            </b>
                            <small>
                              {row.productId || "—"} · {row.stripePriceId || "unmapped"}
                              {row.note ? ` · ${row.note}` : ""}
                            </small>
                          </div>
                          <Badge
                            tone={
                              row.status === "synchronized"
                                ? "success"
                                : row.status === "missing" || row.status === "version_mismatch"
                                  ? "danger"
                                  : "neutral"
                            }
                            dot
                          >
                            {row.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h3>Proposed v4 mappings</h3>
                    <ul className="bc-versions">
                      {data.sync.proposedV4.map((row) => (
                        <li key={`v4-${row.plan}-${row.period}`}>
                          <div>
                            <b>
                              {row.plan} · {row.period}
                            </b>
                            <small>
                              {row.expectedCents != null ? money(row.expectedCents) : "Custom"} ·{" "}
                              {row.productId || "—"}
                              {row.note ? ` · ${row.note}` : ""}
                            </small>
                          </div>
                          <Badge
                            tone={
                              row.status === "synchronized"
                                ? "success"
                                : row.status === "pending_provision"
                                  ? "warning"
                                  : "neutral"
                            }
                            dot
                          >
                            {row.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </div>
            ) : (
              <EmptyState icon="layers" title="Sync report unavailable" />
            )}
          </Panel>
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
                <li>
                  <Icon name="card" size={16} />
                  <div>
                    <b>No silent Stripe mutations</b>
                    <p>Missing or pending mappings are reported here. Live price migration requires explicit approval.</p>
                  </div>
                </li>
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
