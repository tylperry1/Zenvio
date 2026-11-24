"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { CatalogSyncReport } from "@/lib/pricing-sync";
import { money } from "@/lib/billing-types";
import { CATALOG_ID } from "@/lib/pricing-catalog.mjs";
import { formatAllowance } from "@/lib/allowance-display";
import { planDisplayName } from "@/lib/pricing-catalog.mjs";
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
  period?: "monthly" | "annual";
  seats: number;
  amountDue: number;
  currency: string;
};
type WebhookEvent = {
  id: string;
  type: string;
  object_id?: string | null;
  status: string;
  attempts: number;
  error?: string | null;
  livemode?: boolean | null;
  received_at: string;
};
type SyncRun = {
  id: string;
  environment: string;
  catalog_version: string;
  mode: string;
  status: string;
  summary?: {
    productCount?: number;
    priceCount?: number;
    missingProducts?: string[];
    missingPrices?: string[];
    duplicates?: unknown[];
  } | null;
  error?: string | null;
  started_at: string;
};

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
    stripe_product_id?: string | null;
    stripe_price_id?: string | null;
    sync_status: string;
    sync_error?: string | null;
    updated_at?: string;
  };
  const [data, setData] = useState<{
    operations: Operation[];
    coupons?: CouponRow[];
    addons?: AddonRow[];
    sync?: CatalogSyncReport;
    webhookEvents?: WebhookEvent[];
    syncRuns?: SyncRun[];
    publicSurface?: {
      family: string;
      previewOnly: boolean;
      enrollment: { enabled: boolean; plans: string[] };
    };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [last, setLast] = useState<Record<string, unknown> | null>(null);
  const [reconciliation, setReconciliation] = useState<{
    environment: string;
    productCount: number;
    priceCount: number;
    missingProducts: string[];
    missingPrices: string[];
    mismatched: { plan: string; period: string }[];
    duplicates: unknown[];
    obsoletePrices: unknown[];
    checkedAt: string;
  } | null>(null);
  const [section, setSection] = useState<"coupons" | "addons" | "seats" | "audit">(
    params.get("userId") ? "seats" : "audit",
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
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);

  async function retryWebhook(eventId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/billing/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Webhook retry failed.");
      setMessage(
        d.alreadyProcessed
          ? "That delivery was already processed. No duplicate changes were applied."
          : "Webhook reprocessed from the current Stripe object.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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

  if (!data) {
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

  return (
    <div className="ds-root bc">
      <PageHeader
        eyebrow="Billing operations"
        title="Billing & revenue"
        description="Stripe catalog mappings, promotion codes, add-ons, seat changes and audit for the single canonical billing catalog. Prices are immutable in code; this screen never edits them."
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
          label="Canonical plans"
          icon="layers"
          value={4}
          detail="Starter, Professional, Team and extra seat"
        />
        <Kpi
          label="Stripe mappings"
          icon="card"
          value={`${data.sync?.summary.synchronized ?? 0}/8`}
          tone={data.sync?.summary.missing || data.sync?.summary.mismatched ? "warning" : "success"}
          detail="Monthly and annual prices ready"
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
            ["coupons", "Coupons"],
            ["addons", "Add-ons"],
            ["seats", "Seats & proration"],
            ["audit", "Sync & audit"],
          ]}
        />
      </div>

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
                        {c.duration_in_months ? ` ${c.duration_in_months}mo` : ""}
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
                  period: f.get("period"),
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
                  <select id="bc-plan" name="plan" className="bc-input" defaultValue="professional">
                    <option value="starter">Starter</option>
                    <option value="professional">Professional</option>
                    <option value="business">Team</option>
                  </select>
                </Field>
                <Field label="Billing period" htmlFor="bc-period" hint="Monthly or annual for every canonical plan.">
                  <select id="bc-period" name="period" className="bc-input" defaultValue="monthly">
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                  </select>
                </Field>
                <Field label="Total seats" htmlFor="bc-seats" hint="Team requires at least 3 seats. Other plans are one seat.">
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
                  <Badge tone="info">
                    {planDisplayName(preview.plan)}
                  </Badge>{" "}
                  · {preview.period || "monthly"} · {preview.seats} seats · Amount due:{" "}
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
            description="Read-only status for every canonical plan and period. This view never mutates Stripe."
          >
            {data.sync ? (
              <div className="ds-stack">
                <div className="ds-kpis">
                  <Kpi
                    label="Synchronized"
                    value={data.sync.summary.synchronized}
                    tone={data.sync.summary.missing || data.sync.summary.mismatched ? "warning" : "success"}
                    detail="Canonical Stripe prices ready"
                  />
                  <Kpi
                    label="Missing"
                    value={data.sync.summary.missing}
                    tone={data.sync.summary.missing ? "danger" : "success"}
                    detail="No Stripe price mapped"
                  />
                  <Kpi
                    label="Mismatched"
                    value={data.sync.summary.mismatched}
                    tone={data.sync.summary.mismatched ? "danger" : "success"}
                    detail="Mapped to a retired catalog"
                  />
                  <Kpi
                    label="Public surface"
                    value={data.publicSurface?.family?.toUpperCase() || "—"}
                    detail={data.publicSurface?.previewOnly ? "Preview only (not enrollable)" : `Enrollment ${data.publicSurface?.enrollment.enabled ? "open" : "gated"}`}
                  />
                </div>
                <ul className="bc-versions">
                  {data.sync.rows.map((row) => (
                    <li key={`${row.plan}-${row.period}`}>
                      <div>
                        <b>{row.plan} · {row.period}</b>
                        <small>
                          {row.expectedCents != null ? money(row.expectedCents) : "Custom"} · {row.productId || "—"} · {row.stripePriceId || "unmapped"}
                          {row.note ? ` · ${row.note}` : ""}
                        </small>
                      </div>
                      <Badge tone={row.status === "synchronized" ? "success" : "danger"} dot>
                        {row.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <EmptyState icon="layers" title="Sync report unavailable" />
            )}
          </Panel>
          <Panel
            title="Stripe reconciliation"
            description="Read-only comparison against Stripe. Detects missing products, missing prices, mapping mismatches, duplicate active prices, and obsolete prices without changing anything."
            actions={
              <button
                type="button"
                className="ds-btn sm"
                disabled={busy}
                onClick={async () => {
                  const result = await send({
                    action: "stripe-reconcile",
                    reason: "Read-only Stripe catalog reconciliation",
                  });
                  if (result?.reconciliation) setReconciliation(result.reconciliation);
                }}
              >
                Reconcile now
              </button>
            }
          >
            {reconciliation ? (
              <div className="ds-stack">
                <div className="ds-kpis">
                  <Kpi
                    label="Environment"
                    value={reconciliation.environment.toUpperCase()}
                    tone={reconciliation.environment === "live" ? "warning" : "info"}
                    detail={`Checked ${formatDate(reconciliation.checkedAt, { dateStyle: "medium", timeStyle: "short" })}`}
                  />
                  <Kpi label="Products" value={reconciliation.productCount} detail="Matching catalog products" />
                  <Kpi
                    label="Missing"
                    value={reconciliation.missingProducts.length + reconciliation.missingPrices.length}
                    tone={
                      reconciliation.missingProducts.length || reconciliation.missingPrices.length
                        ? "danger"
                        : "success"
                    }
                    detail="Products or prices not found in Stripe"
                  />
                  <Kpi
                    label="Mismatched"
                    value={reconciliation.mismatched.length}
                    tone={reconciliation.mismatched.length ? "danger" : "success"}
                    detail="Stored mappings that differ from Stripe"
                  />
                  <Kpi
                    label="Duplicates"
                    value={reconciliation.duplicates.length}
                    tone={reconciliation.duplicates.length ? "warning" : "success"}
                    detail={`${reconciliation.obsoletePrices.length} obsolete active price(s) reported, never deleted`}
                  />
                </div>
                {reconciliation.missingProducts.length ? (
                  <Notice tone="warning">
                    Missing products: {reconciliation.missingProducts.join(", ")}. Run the approved test-mode provisioner; live Stripe changes still require explicit approval.
                  </Notice>
                ) : null}
                {reconciliation.mismatched.length ? (
                  <Notice tone="warning">
                    Mismatched mappings:{" "}
                    {reconciliation.mismatched
                      .map((row) => `${row.plan}/${row.period}`)
                      .join(", ")}
                    . Re-link the approved catalog before enabling checkout.
                  </Notice>
                ) : null}
              </div>
            ) : data.syncRuns?.length ? (
              <ul className="bc-versions">
                {data.syncRuns.map((run) => (
                  <li key={run.id}>
                    <div>
                      <b>
                        {run.mode} · {run.environment}
                      </b>
                      <small>
                        {run.status} · {formatDate(run.started_at, { dateStyle: "medium", timeStyle: "short" })}
                        {run.summary?.productCount != null ? ` · ${run.summary.productCount} products` : ""}
                        {run.summary?.priceCount != null ? ` · ${run.summary.priceCount} prices` : ""}
                        {run.summary?.duplicates?.length ? ` · ${run.summary.duplicates.length} duplicates` : ""}
                      </small>
                      {run.error ? <small>{run.error}</small> : null}
                    </div>
                    <Badge tone={run.status === "succeeded" ? "success" : "danger"} dot>
                      {run.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="layers" title="No reconciliation yet">
                Run a read-only reconciliation to compare the catalog with Stripe.
              </EmptyState>
            )}
          </Panel>
          <Panel
            title="Webhook deliveries"
            description="Every signed Stripe delivery is recorded. Failed events can be retried from the current Stripe object without creating duplicate credits."
          >
            {!data.webhookEvents?.length ? (
              <EmptyState icon="shield" title="No webhook deliveries recorded" />
            ) : (
              <ul className="bc-versions">
                {data.webhookEvents.map((event) => (
                  <li key={event.id}>
                    <div>
                      <b>{event.type}</b>
                      <small>
                        <code>{event.id}</code> · {formatDate(event.received_at, { dateStyle: "medium", timeStyle: "short" })}
                        {event.attempts > 1 ? ` · ${event.attempts} attempts` : ""}
                        {event.livemode ? " · live mode" : ""}
                      </small>
                      {event.error ? <small>{event.error}</small> : null}
                    </div>
                    <Badge
                      tone={
                        event.status === "processed"
                          ? "success"
                          : event.status === "failed"
                            ? "danger"
                            : event.status === "ignored"
                              ? "neutral"
                              : "warning"
                      }
                      dot
                    >
                      {event.status}
                    </Badge>
                    {event.status === "failed" ? (
                      <button
                        type="button"
                        className="ds-btn sm"
                        disabled={busy}
                        onClick={() => void retryWebhook(event.id)}
                      >
                        Retry
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <div className="ds-grid-2">
            <Panel title="Sync status & financial audit" description="Provider failures stay visible. Retry with the same operation id to avoid duplicate charges.">
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
                    <b>Canonical catalog</b>
                    <p>Prices are fixed in code. Only Stripe mappings and promotion codes are managed here.</p>
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
