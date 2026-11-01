// Supplier acquisition pipeline definitions shared by the admin API and UI.

export const pipelineStatuses = [
  ["identified", "Identified"],
  ["contacted", "Contacted"],
  ["application_submitted", "Application submitted"],
  ["awaiting_response", "Awaiting response"],
  ["under_review", "Under review"],
  ["approved", "Approved"],
  ["integration_in_progress", "Integration in progress"],
  ["testing", "Testing"],
  ["active", "Active"],
  ["rejected", "Rejected"],
  ["suspended", "Suspended"],
] as const;
export type PipelineStatus = (typeof pipelineStatuses)[number][0];
export const isPipelineStatus = (v: unknown): v is PipelineStatus => pipelineStatuses.some(([s]) => s === v);

export const scorecardCriteria = [
  ["api", "API capabilities"],
  ["quality", "Product quality"],
  ["pricing", "Wholesale pricing"],
  ["shipping", "Shipping reliability"],
  ["turnaround", "Production turnaround"],
  ["returns", "Return policy"],
  ["minimums", "Minimum order requirements"],
  ["support", "Customer support"],
] as const;

export const apiAvailability = [
  ["unknown", "Not yet verified"],
  ["public_docs", "Public API documentation"],
  ["partner_only", "API for approved partners only"],
  ["none", "No API (manual fulfillment)"],
] as const;
export const integrationStatuses = [
  ["not_started", "Not started"],
  ["credentials_pending", "Awaiting credentials"],
  ["configured", "Configured"],
  ["testing", "Testing"],
  ["live", "Live"],
  ["error", "Error"],
  ["disabled", "Disabled"],
] as const;
export const agreementStatuses = [
  ["none", "No agreement"],
  ["negotiating", "Negotiating"],
  ["signed", "Signed"],
  ["terminated", "Terminated"],
] as const;

/**
 * Initial acquisition targets. Only names, official websites and the product
 * families they are known for are prefilled; terms, fees, APIs and contacts are
 * left for the team to verify and record.
 */
export const recommendedTargets = [
  { name: "Printful", website: "https://www.printful.com", categories: ["apparel", "promo"], fulfillment: "print_on_demand", connector: "printful" },
  { name: "Gelato", website: "https://www.gelato.com", categories: ["apparel", "stationery", "marketing"], fulfillment: "print_on_demand", connector: null },
  { name: "4over", website: "https://www.4over.com", categories: ["stationery", "marketing", "signs"], fulfillment: "wholesale", connector: null },
  { name: "Printify", website: "https://printify.com", categories: ["apparel", "promo"], fulfillment: "print_on_demand", connector: null },
  { name: "Prodigi", website: "https://www.prodigi.com", categories: ["marketing", "stationery", "promo"], fulfillment: "print_on_demand", connector: null },
  { name: "4OVER4", website: "https://www.4over4.com", categories: ["stationery", "marketing", "promo"], fulfillment: "wholesale", connector: null },
] as const;

/** Average of scored criteria (1–5), or null when nothing is scored. */
export function scorecardAverage(scores: Record<string, unknown>) {
  const values = scorecardCriteria.map(([k]) => scores?.[k]).filter((v): v is number => typeof v === "number" && v >= 1 && v <= 5);
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
}
