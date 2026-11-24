import { ADDONS } from "./pricing-catalog.mjs";

export type PublicAddon = {
  id: string;
  name: string;
  amount: number;
  quantity: number;
  unit: string;
  recurring: boolean;
  available: boolean;
};

/** SMS is never advertised on public surfaces, even as "coming soon". */
export function publicAddonsForDisplay(
  addons: ReadonlyArray<PublicAddon | (typeof ADDONS)[number]> = ADDONS,
): PublicAddon[] {
  return addons
    .filter((a) => a.unit !== "smsSegments" && !/^sms/i.test(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      amount: a.amount,
      quantity: a.quantity,
      unit: a.unit,
      recurring: a.recurring,
      available: a.available === true,
    }));
}

export function formatUsdCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "Custom";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** Helpful billing copy derived from the live published catalog (never draft/v4-only). */
export function liveBillingHelpText(catalog: {
  offers: { id: string; name: string; monthly: number; seats: number }[];
}): string {
  const starter = catalog.offers.find((o) => o.id === "starter");
  const professional = catalog.offers.find((o) => o.id === "professional");
  const team = catalog.offers.find((o) => o.id === "business");
  const extra = catalog.offers.find((o) => o.id === "business_extra");
  if (!starter || !professional || !team || !extra) {
    return "Open Usage & Billing to see your plan and allowances. Add-ons and paid checkout appear in Plan & billing when they’re turned on for your account.";
  }
  return `${starter.name} is ${formatUsdCents(starter.monthly)} monthly. ${professional.name} is ${formatUsdCents(professional.monthly)} monthly. ${team.name} is ${formatUsdCents(team.monthly)} monthly with ${team.seats} seats, plus ${formatUsdCents(extra.monthly)} per additional seat. Open Usage & Billing to see your plan and allowances. Add-ons and paid checkout appear in Plan & billing when they’re turned on for your account.`;
}
