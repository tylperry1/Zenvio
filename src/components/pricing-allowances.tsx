import { monthlyAllowances, addonOffers } from "@/lib/subscription-offers.mjs";
import { money } from "@/lib/billing-types";

export function PricingAllowances() {
  const i = monthlyAllowances.individual, t = monthlyAllowances.team;
  const rows = [
    ["Transactional emails", i.emails.toLocaleString(), t.emails.toLocaleString()],
    ["AI credits", i.aiCredits, t.aiCredits],
    ["Signing envelopes", i.envelopes, t.envelopes],
    ["Video participant-minutes", i.videoMinutes, t.videoMinutes],
    ["Private storage", "2 GB", "10 GB"],
  ];
  return (
    <section className="subscription-invoices pricing-allowances" aria-labelledby="allowance-title">
      <header className="allowance-heading">
        <span className="subscription-kicker">MONTHLY ALLOWANCES</span>
        <h3 id="allowance-title">Included in your workspace</h3>
        <p>One clear allowance for each plan. Teams share a single pool; extra seats add people without increasing credits.</p>
      </header>
      <div className="allowance-table-wrap">
        <table className="allowance-table">
          <caption className="sr-only">New monthly subscription allowances</caption>
          <thead><tr><th scope="col">Included usage</th><th scope="col">Individual</th><th scope="col">Teams <span>Shared pool</span></th></tr></thead>
          <tbody>{rows.map(([name, individual, team]) => <tr key={name}><th scope="row">{name}</th><td>{individual}</td><td>{team}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="allowance-summary">Bookings and CRM contacts have no per-item charge. Fair-use and abuse protections apply.</p>
      <details className="allowance-details">
        <summary>How usage is measured</summary>
        <p>Consumable allowances reset each calendar month at 00:00 UTC. Storage is concurrent capacity. One person connected to video for one minute uses one participant-minute.</p>
        <p>AI usage is rounded up per execution; one credit covers up to $0.01 of provider cost. Features become available when their integrations are ready.</p>
      </details>
      <div className="allowance-addons-heading">
        <div><h3>Optional capacity</h3><p>Additional capacity at predictable prices.</p></div>
        <span className="allowance-coming-soon">Coming soon</span>
      </div>
      <p className="allowance-availability">Purchasing is not yet enabled. These prices are for reference; no add-on is charged or activated here.</p>
      <ul className="allowance-addons">
        {addonOffers.map(offer => <li key={offer.id}>
          <div><h4>{offer.name}</h4><span>{offer.id.startsWith("sms") ? "US SMS · sender and pricing review required" : offer.recurring ? "Monthly capacity" : "Prepaid capacity"}</span></div>
          <p><strong>{money(offer.amount)}</strong><small>{offer.recurring ? "/ month" : "one-time"}</small></p>
        </li>)}
      </ul>
      <details className="allowance-details">
        <summary>Credit, storage and SMS terms</summary>
        <p>Purchased consumable credits do not silently expire. Refund adjustments account for consumed credits. Monthly storage and SMS packages do not roll over. Existing subscribers retain their contracted benefits.</p>
        <p>SMS is separate. International SMS, MMS and premium destinations are unavailable.</p>
      </details>
    </section>
  );
}
