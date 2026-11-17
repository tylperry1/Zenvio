import Link from "next/link";
import { Icon } from "./icons";
import { monthlyAllowances } from "@/lib/subscription-offers.mjs";
import { money } from "@/lib/billing-types";
import { publicAddonsForDisplay, type PublicAddon } from "@/lib/public-pricing-display";

type Allowances = import("@/lib/billing-catalog").BillingCatalog["allowances"];

function formatStorage(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  // Catalog storage allowances use decimal (SI) byte sizes, e.g. 2_000_000_000 => 2 GB.
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
  return `${bytes.toLocaleString()} B`;
}

function formatCount(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : "—";
}

const ROW_META = [
  { key: "emails" as const, label: "Transactional emails", icon: "mail" },
  { key: "aiCredits" as const, label: "AI credits", icon: "sparkles" },
  { key: "envelopes" as const, label: "Signing envelopes", icon: "file" },
  { key: "videoMinutes" as const, label: "Video participant-minutes", icon: "video" },
  { key: "storageBytes" as const, label: "Private storage", icon: "layers" },
];

export function PricingAllowances({
  allowances = monthlyAllowances,
  addons = publicAddonsForDisplay(),
  variant = "full",
}: {
  allowances?: Allowances;
  addons?: PublicAddon[];
  variant?: "full" | "compact";
} = {}) {
  const i = allowances.individual;
  const t = allowances.team;
  const rows = ROW_META.map((row) => ({
    ...row,
    individual: row.key === "storageBytes" ? formatStorage(i.storageBytes) : formatCount(i[row.key]),
    team: row.key === "storageBytes" ? formatStorage(t.storageBytes) : formatCount(t[row.key]),
  }));

  return (
    <section className={`pricing-allowances pricing-allowances-${variant}`} aria-labelledby="allowance-title">
      <header className="allowance-heading">
        <div>
          <span className="subscription-kicker">MONTHLY ALLOWANCES</span>
          <h3 id="allowance-title">{variant === "compact" ? "Monthly allowances" : "Included in your workspace"}</h3>
        </div>
        {variant === "compact" ? (
          <Link href="/pricing#allowances" className="allowance-details-link">
            View usage details &amp; add-ons <Icon name="arrow" size={15} />
          </Link>
        ) : (
          <p>One clear allowance for each plan. Teams share a single pool; extra seats add people without increasing credits.</p>
        )}
      </header>

      <div className="allowance-table-wrap">
        <table className="allowance-table">
          <caption className="sr-only">Monthly subscription allowances for Individual and Teams</caption>
          <thead>
            <tr>
              <th scope="col">Included usage</th>
              <th scope="col">Individual</th>
              <th scope="col" className="allowance-team-col">
                Teams <span>Shared pool</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  <span className="allowance-row-label">
                    <Icon name={row.icon} size={15} />
                    {row.label}
                  </span>
                </th>
                <td data-label="Individual">{row.individual}</td>
                <td className="allowance-team-col" data-label="Teams · shared">{row.team}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="allowance-summary">
        Feature availability depends on activation. Teams share applicable allowances across seats.
      </p>

      {variant === "full" && (
        <>
          <details className="allowance-details">
            <summary>How usage is measured</summary>
            <p>Consumable allowances reset each calendar month at 00:00 UTC. Storage is concurrent capacity. One person connected to video for one minute uses one participant-minute.</p>
            <p>AI usage is rounded up per execution; one credit covers up to $0.01 of provider cost. Features become available when their integrations are ready.</p>
          </details>
          <div className="allowance-addons-heading" id="allowances">
            <div>
              <h3>Optional capacity</h3>
              <p>Additional capacity at predictable prices.</p>
            </div>
            <span className="allowance-coming-soon">Coming soon</span>
          </div>
          <p className="allowance-availability">Purchasing is not yet enabled. These prices are for reference; no add-on is charged or activated here.</p>
          <ul className="allowance-addons">
            {addons.map((offer) => (
              <li key={offer.id}>
                <div>
                  <h4>{offer.name}</h4>
                  <span>{offer.recurring ? "Monthly capacity" : "Prepaid capacity"}</span>
                </div>
                <p>
                  <strong>{money(offer.amount)}</strong>
                  <small>{offer.recurring ? "/ month" : "one-time"}</small>
                </p>
              </li>
            ))}
          </ul>
          <details className="allowance-details">
            <summary>Credit and storage terms</summary>
            <p>Purchased consumable credits do not silently expire. Refund adjustments account for consumed credits. Monthly storage packages do not roll over. Existing subscribers retain their contracted benefits.</p>
            <p>SMS messaging is not offered for purchase on this catalog.</p>
          </details>
        </>
      )}
    </section>
  );
}
