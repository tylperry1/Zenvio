"use client";
import { useEffect, useState } from "react";
import { Badge, EmptyState, Kpi, Notice, Panel, Skeleton, Timeline, formatDate, usd } from "./ds";
import { Icon } from "./icons";
import { Modal } from "./modal";

type Mapping = { period: string; priceId: string };
type Count = { active: number; past_due: number; seats: number };
type Plan = { id: string; name: string; monthly: number; annual: number; seats: number; stripe: Mapping[]; subscribers: Count | null };
type Data = {
  readiness: { connected: boolean; pricesReady: boolean; checkoutEnabled: boolean };
  packages: Plan[];
  legacy: Plan[];
  limits: Record<string, { types: number; calendars: number; envelopes: number; workflows: number }>;
  envelopes: { includedPerSeat: number; overageCents: number; capRangeCents: [number, number] };
  features: string[];
  earlyAccess: { offer: string; total: number; open: number };
  history: { id: string; created_at: string; actor: string | null; details: { plans?: { id: string; name: string; monthly: number; annual: number }[] } }[];
};
type Draft = Record<string, { monthly: string; annual: string }>;

// Annual savings only when an annual price is actually configured below 12× monthly.
function annualNote(monthly: number, annual: number) {
  if (!monthly) return { text: "No charge", tone: "neutral" as const };
  if (!annual) return { text: "Annual not offered", tone: "neutral" as const };
  const full = monthly * 12;
  if (annual >= full) return { text: "No annual discount", tone: "neutral" as const };
  return { text: `Saves ${Math.round((1 - annual / full) * 100)}% annually`, tone: "success" as const };
}
const toCents = (v: string) => Math.round(Number(v) * 100);
const validPrice = (v: string, max: number) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max;

export function AdminPricing() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [seats, setSeats] = useState(5);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/admin/pricing", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load pricing.");
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  if (error && !data) return <Notice tone="danger">{error}</Notice>;
  if (!data)
    return (
      <div className="ds-kpis">
        {[0, 1, 2, 3].map((i) => (
          <Kpi key={i} label="Loading" value="" loading />
        ))}
      </div>
    );

  const individual = data.packages.find((p) => p.id === "individual")!;
  const team = data.packages.find((p) => p.id === "team")!;
  const extra = data.packages.find((p) => p.id === "team_extra")!;
  const teamTotal = team.monthly + Math.max(0, seats - 3) * extra.monthly;
  const currentSubs = (individual.subscribers?.active || 0) + (team.subscribers?.active || 0);
  const legacySubs = data.legacy.reduce((s, p) => s + (p.id === "free" ? 0 : p.subscribers?.active || 0), 0);
  const r = data.readiness;
  const gates = [
    [r.connected, "Stripe secret key connected"],
    [r.pricesReady, "Recurring prices mapped for Individual, Teams and extra seats"],
    [r.checkoutEnabled, "Launch flag BILLING_CHECKOUT_ENABLED turned on"],
  ] as const;

  const changes = draft
    ? data.legacy
        .filter((p) => p.id !== "free")
        .map((p) => ({ plan: p, monthly: toCents(draft[p.id].monthly), annual: toCents(draft[p.id].annual) }))
        .filter((c) => c.monthly !== c.plan.monthly || c.annual !== c.plan.annual)
    : [];
  const draftValid =
    !!draft &&
    data.legacy.filter((p) => p.id !== "free").every((p) => validPrice(draft[p.id].monthly, 10000) && validPrice(draft[p.id].annual, 120000));

  async function publish() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const plans = data!.legacy.map((p) => ({
        id: p.id,
        monthly: p.id === "free" ? 0 : toCents(draft[p.id].monthly),
        annual: p.id === "free" ? 0 : toCents(draft[p.id].annual),
      }));
      const res = await fetch("/api/admin/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pricing", plans }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Unable to save pricing.");
      await load();
      setDraft(null);
      setReview(false);
      setNotice(`Legacy rates updated (${changes.length} plan${changes.length === 1 ? "" : "s"}). Existing subscriptions keep their current Stripe price.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save pricing.");
    } finally {
      setBusy(false);
    }
  }

  // Each history entry shows what changed compared with the entry before it.
  const history = data.history.map((h, i) => {
    const prev = data.history[i + 1]?.details.plans || [];
    const diffs = (h.details.plans || [])
      .map((p) => {
        const before = prev.find((q) => q.id === p.id);
        if (!before) return null;
        const parts = [];
        if (before.monthly !== p.monthly) parts.push(`${usd(before.monthly)} → ${usd(p.monthly)}/mo`);
        if (before.annual !== p.annual) parts.push(`${usd(before.annual)} → ${usd(p.annual)}/yr`);
        return parts.length ? `${p.name}: ${parts.join(", ")}` : null;
      })
      .filter(Boolean);
    return {
      id: h.id,
      title: diffs.length ? diffs.join(" · ") : i === data.history.length - 1 ? "Legacy rates saved" : "Saved with no rate changes",
      meta: `${formatDate(h.created_at, { dateStyle: "medium", timeStyle: "short" })}${h.actor ? ` · ${h.actor}` : ""}`,
      icon: "spark",
    };
  });

  return (
    <div className="ds-root ap">
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="ds-kpis">
        <Kpi label="Published packages" icon="layers" value={2} detail="Individual and Teams on /pricing" />
        <Kpi label="Current-package subscribers" icon="users" value={currentSubs} detail="Active or trialing" />
        <Kpi label="Grandfathered subscribers" icon="clock" value={legacySubs} detail="Keep their original price" />
        <Kpi
          label="Checkout"
          icon="card"
          value={r.checkoutEnabled ? "Live" : "Gated"}
          tone={r.checkoutEnabled ? "success" : "warning"}
          detail={r.checkoutEnabled ? "New customers can subscribe" : `${gates.filter(([ok]) => ok).length} of 3 launch gates met`}
        />
      </div>

      {!r.checkoutEnabled && (
        <Panel title="Launch readiness" description="Paid enrollment opens only when every gate passes. Visitors join early access until then.">
          <ul className="ap-gates">
            {gates.map(([ok, label]) => (
              <li key={label} className={ok ? "ok" : ""}>
                <span aria-hidden="true">{ok ? <Icon name="check" size={13} /> : null}</span>
                {label}
                <Badge tone={ok ? "success" : "warning"}>{ok ? "Ready" : "Pending"}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="ap-section-title">
        <h2>Current packages</h2>
        <p>Approved rates are part of the reviewed release and change only through a code update, so the public page and Stripe always agree.</p>
      </div>
      <div className="ap-packages">
        {[individual, team].map((p) => (
          <article key={p.id} className={`ap-package ${p.id === "team" ? "featured" : ""}`}>
            <header>
              <div>
                <h3>{p.name}</h3>
                <p>{p.id === "team" ? "Shared scheduling for 3 or more hosts" : "Everything a single host needs"}</p>
              </div>
              <Badge tone="info" dot>Published</Badge>
            </header>
            <div className="ap-price">
              <strong>{usd(p.monthly)}</strong>
              <span>/ month{p.id === "team" ? " · includes 3 seats" : ""}</span>
            </div>
            <dl className="ds-dl">
              <div><dt>Billing</dt><dd>Monthly only</dd></div>
              <div><dt>Subscribers</dt><dd>{p.subscribers?.active || 0}{p.subscribers?.past_due ? ` · ${p.subscribers.past_due} past due` : ""}</dd></div>
              <div><dt>Envelopes</dt><dd>{data.envelopes.includedPerSeat} per seat / month</dd></div>
              <div>
                <dt>Stripe</dt>
                <dd>
                  <StripeStatus mappings={p.stripe} />
                </dd>
              </div>
            </dl>
            {p.id === "team" && (
              <div className="ap-calculator">
                <div className="ap-calc-head">
                  <label htmlFor="ap-seats">Seat calculator</label>
                  <span>
                    Extra seats <b>{usd(extra.monthly)}</b> each · <StripeStatus mappings={extra.stripe} compact />
                  </span>
                </div>
                <div className="ap-calc-row">
                  <input id="ap-seats" type="range" min={3} max={50} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
                  <output htmlFor="ap-seats">{seats} seats</output>
                </div>
                <p>
                  {usd(team.monthly)} base{seats > 3 ? ` + ${seats - 3} × ${usd(extra.monthly)}` : ""} = <b>{usd(teamTotal)} / month</b>
                  <small> · {data.envelopes.includedPerSeat * seats} pooled envelopes</small>
                </p>
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="ds-grid-2">
        <Panel title="Included in every package" description="Per host unless noted. Shown to customers on the public pricing page.">
          <ul className="ap-features">
            {data.features.map((f) => (
              <li key={f}>
                <Icon name="check" size={14} /> {f}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Signing envelopes & overages" description="Usage beyond the monthly allowance.">
          <dl className="ds-dl ap-envelopes">
            <div><dt>Included</dt><dd>{data.envelopes.includedPerSeat} per seat each UTC month</dd></div>
            <div><dt>Overage price</dt><dd>{usd(data.envelopes.overageCents)} per envelope</dd></div>
            <div><dt>Overages</dt><dd>Off by default</dd></div>
            <div><dt>Spending cap</dt><dd>{usd(data.envelopes.capRangeCents[0])}–{usd(data.envelopes.capRangeCents[1])} set by billing owner</dd></div>
          </dl>
          <p className="ap-muted">Allowances never roll over. Overages are invoiced separately after month end and only for active paid subscriptions.</p>
          <div className="ap-offer">
            <Icon name="sparkles" size={15} />
            <div>
              <b>Early-access offer</b>
              <p>
                {data.earlyAccess.offer}. {data.earlyAccess.total} reservation{data.earlyAccess.total === 1 ? "" : "s"}, {data.earlyAccess.open} not yet claimed.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        flush
        title="Legacy packages"
        description="No longer sold. These reference rates apply to grandfathered subscribers; editing them never reprices an existing Stripe subscription."
        actions={
          draft ? (
            <>
              <button className="ds-btn sm ghost" onClick={() => setDraft(null)} disabled={busy}>
                Discard
              </button>
              <button className="ds-btn sm primary" disabled={!changes.length || !draftValid || busy} onClick={() => setReview(true)}>
                Review {changes.length || ""} change{changes.length === 1 ? "" : "s"}
              </button>
            </>
          ) : (
            <button
              className="ds-btn sm"
              onClick={() =>
                setDraft(Object.fromEntries(data.legacy.map((p) => [p.id, { monthly: (p.monthly / 100).toFixed(2), annual: (p.annual / 100).toFixed(2) }])))
              }
            >
              <Icon name="settings" size={14} /> Edit rates
            </button>
          )
        }
      >
        <div className="ds-table-wrap">
          <table className="ds-table ap-legacy">
            <thead>
              <tr>
                <th>Package</th>
                <th>Status</th>
                <th className="num">Monthly</th>
                <th className="num">Annual total</th>
                <th>Annual savings</th>
                <th className="num">Subscribers</th>
                <th>Stripe</th>
              </tr>
            </thead>
            <tbody>
              {data.legacy.map((p) => {
                const editing = draft && p.id !== "free";
                const monthly = editing ? toCents(draft[p.id].monthly) : p.monthly;
                const annual = editing ? toCents(draft[p.id].annual) : p.annual;
                const note = annualNote(monthly, annual);
                return (
                  <tr key={p.id}>
                    <td>
                      <b className="ap-plan-name">{p.name.replace(/ \(legacy\)$/i, "")}</b>
                    </td>
                    <td>{p.id === "free" ? <Badge>Free tier</Badge> : <Badge tone="warning">Retired</Badge>}</td>
                    <td className="num">
                      {editing ? (
                        <MoneyInput label={`${p.name} monthly price`} value={draft[p.id].monthly} max={10000} onChange={(v) => setDraft({ ...draft, [p.id]: { ...draft[p.id], monthly: v } })} />
                      ) : (
                        usd(p.monthly)
                      )}
                    </td>
                    <td className="num">
                      {editing ? (
                        <MoneyInput label={`${p.name} annual total`} value={draft[p.id].annual} max={120000} onChange={(v) => setDraft({ ...draft, [p.id]: { ...draft[p.id], annual: v } })} />
                      ) : p.annual ? (
                        usd(p.annual)
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Badge tone={note.tone}>{note.text}</Badge>
                    </td>
                    <td className="num">{p.subscribers?.active || 0}</td>
                    <td>
                      <StripeStatus mappings={p.stripe} compact />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Change history" description="Every saved rate change, from the operations audit log.">
        {history.length ? (
          <Timeline items={history} />
        ) : (
          <EmptyState icon="clock" title="No pricing changes yet">
            Saved legacy rate changes will appear here with who made them.
          </EmptyState>
        )}
      </Panel>

      {review && draft && (
        <Modal title="Publish legacy rate changes?" onClose={() => !busy && setReview(false)}>
          <div className="ap-review">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Package</th>
                  <th className="num">Monthly</th>
                  <th className="num">Annual</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.plan.id}>
                    <td>{c.plan.name}</td>
                    <td className="num">
                      <Diff from={c.plan.monthly} to={c.monthly} />
                    </td>
                    <td className="num">
                      <Diff from={c.plan.annual} to={c.annual} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Notice tone="info">
              Existing subscribers stay on the Stripe price they signed up with. Legacy packages are not offered to new customers, so no checkout changes. The change is recorded in the audit log.
            </Notice>
            <div className="ap-review-actions">
              <button className="ds-btn" onClick={() => setReview(false)} disabled={busy}>
                Back to editing
              </button>
              <button className="ds-btn primary" onClick={() => void publish()} disabled={busy}>
                {busy ? "Saving…" : "Publish changes"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StripeStatus({ mappings, compact }: { mappings: Mapping[]; compact?: boolean }) {
  if (!mappings.length) return <Badge tone="warning">Not mapped</Badge>;
  const id = mappings[0].priceId;
  return (
    <span className="ap-stripe" title={mappings.map((m) => `${m.period}: ${m.priceId}`).join("\n")}>
      <Badge tone="success" dot>
        Synced
      </Badge>
      {!compact && <code>{id.length > 18 ? `${id.slice(0, 14)}…` : id}</code>}
    </span>
  );
}
function MoneyInput({ value, onChange, label, max }: { value: string; onChange: (v: string) => void; label: string; max: number }) {
  const invalid = !validPrice(value, max);
  return (
    <span className={`ap-money ${invalid ? "invalid" : ""}`}>
      <span aria-hidden="true">$</span>
      <input inputMode="decimal" aria-label={label} aria-invalid={invalid} value={value} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}
function Diff({ from, to }: { from: number; to: number }) {
  if (from === to) return <span className="ap-muted">{usd(from)}</span>;
  return (
    <span className="ap-diff">
      <s>{usd(from)}</s> → <b>{usd(to)}</b>
    </span>
  );
}
