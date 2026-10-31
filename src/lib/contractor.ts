// Industry presets and estimate math shared by the workspace, public request form and portal.
// Pure module: safe to import from client components.
import type { Question } from "./intake";

export const industries = [
  { id: "general", label: "General / other services", contractor: false, categories: [] as string[] },
  {
    id: "general_contractor",
    label: "General contractor",
    contractor: true,
    categories: ["Remodel", "Repair", "Addition", "Inspection", "Other"],
  },
  {
    id: "electrician",
    label: "Electrician",
    contractor: true,
    categories: ["Outlet or switch", "Lighting", "Panel or breaker", "EV charger", "Troubleshooting", "Other"],
  },
  {
    id: "plumbing",
    label: "Plumbing",
    contractor: true,
    categories: ["Leak", "Clog or drain", "Water heater", "Fixture install", "Emergency", "Other"],
  },
  {
    id: "hvac",
    label: "HVAC",
    contractor: true,
    categories: ["No heat", "No cooling", "Maintenance", "Installation", "Thermostat", "Other"],
  },
  {
    id: "cleaning",
    label: "Cleaning",
    contractor: true,
    categories: ["Standard clean", "Deep clean", "Move in / out", "Office", "Other"],
  },
  {
    id: "landscaping",
    label: "Landscaping",
    contractor: true,
    categories: ["Lawn care", "Planting", "Hardscape", "Cleanup", "Irrigation", "Other"],
  },
  {
    id: "handyman",
    label: "Handyman",
    contractor: true,
    categories: ["Repair", "Assembly", "Mounting", "Painting", "Other"],
  },
] as const;
export type IndustryId = (typeof industries)[number]["id"];

export function contractorIndustry(value: unknown) {
  return industries.some((i) => i.id === value && i.contractor);
}
export function industryInfo(value: unknown) {
  return industries.find((i) => i.id === value) || industries[0];
}

// Booking-form preset for trade businesses: job site, category, problem, photos and consent.
export function contractorIntakeTemplate(industry: unknown): Question[] {
  const info = industryInfo(industry);
  const categories = info.categories.length ? [...info.categories] : ["Repair", "Installation", "Estimate", "Other"];
  return [
    { id: "job_address", label: "Job site address", type: "address", required: true, options: [] },
    { id: "service_category", label: "What do you need help with?", type: "dropdown", required: true, options: categories },
    { id: "problem", label: "Describe the problem", type: "long_text", required: true, options: [] },
    { id: "mobile", label: "Mobile number for day-of updates", type: "phone", required: false, options: [] },
    { id: "photos", label: "Photos of the area (optional)", type: "file", required: false, options: [] },
    {
      id: "site_access",
      label: "I confirm someone 18+ will be on site and the work area is accessible.",
      type: "consent",
      required: true,
      options: [],
    },
  ];
}

export type LineItem = { description: string; quantity: number; unit_cents: number };
// Quantities allow two decimals (hours, square feet); totals are rounded per line.
export function estimateTotals(items: LineItem[], taxRateBps: number, depositCents = 0) {
  const lines = items.map((i) => ({ ...i, total_cents: Math.round(i.quantity * i.unit_cents) }));
  const subtotal = lines.reduce((s, l) => s + l.total_cents, 0);
  const tax = Math.round((subtotal * taxRateBps) / 10000);
  const total = subtotal + tax;
  return { lines, subtotal_cents: subtotal, tax_cents: tax, total_cents: total, deposit_cents: Math.min(depositCents, total) };
}

export const jobStatuses = [
  { id: "requested", label: "New request", tone: "info" },
  { id: "approved", label: "Accepted", tone: "info" },
  { id: "scheduled", label: "Scheduled", tone: "info" },
  { id: "in_progress", label: "In progress", tone: "warning" },
  { id: "completed", label: "Completed", tone: "success" },
  { id: "declined", label: "Declined", tone: "neutral" },
  { id: "cancelled", label: "Cancelled", tone: "neutral" },
] as const;

export const money = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
