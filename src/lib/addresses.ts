/** Structured address model shared by CRM, booking, and business profiles. */

export const ADDRESS_TYPES = [
  "residential",
  "billing",
  "business",
  "service_saved",
  "custom_meeting",
] as const;

export type AddressType = (typeof ADDRESS_TYPES)[number];

export const LOCATION_MODES = [
  "at_business",
  "at_customer",
  "virtual",
  "custom",
] as const;

export type LocationMode = (typeof LOCATION_MODES)[number];

export type StructuredAddress = {
  street: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  formatted: string;
  accessInstructions?: string;
  validated?: boolean;
  smartyKey?: string;
  source?: "manual" | "smarty" | "import" | "migration";
};

export function emptyAddress(): StructuredAddress {
  return {
    street: "",
    street2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "US",
    formatted: "",
    accessInstructions: "",
    validated: false,
    smartyKey: "",
    source: "manual",
  };
}

export function formatAddress(parts: Partial<StructuredAddress>): string {
  const line1 = [parts.street, parts.street2].filter(Boolean).join(", ");
  const line2 = [parts.city, parts.state, parts.postalCode].filter(Boolean).join(", ");
  return [line1, line2, parts.country && parts.country !== "US" ? parts.country : ""]
    .filter(Boolean)
    .join(" · ")
    .trim()
    .slice(0, 500);
}

export function parseAddressInput(input: unknown): StructuredAddress {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const text = (v: unknown, max: number) =>
    String(v ?? "")
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .trim()
      .slice(0, max);
  const street = text(raw.street ?? raw.line1, 200);
  const street2 = text(raw.street2 ?? raw.secondary ?? raw.line2, 100);
  const city = text(raw.city, 100);
  const state = text(raw.state, 50);
  const postalCode = text(raw.postalCode ?? raw.zip ?? raw.zipCode, 20);
  const country = text(raw.country || "US", 2).toUpperCase() || "US";
  const accessInstructions = text(raw.accessInstructions, 1000);
  const formatted =
    text(raw.formatted, 500) ||
    formatAddress({ street, street2, city, state, postalCode, country });
  return {
    street,
    street2,
    city,
    state,
    postalCode,
    country,
    formatted,
    accessInstructions,
    validated: raw.validated === true,
    smartyKey: text(raw.smartyKey, 64),
    source:
      raw.source === "smarty" || raw.source === "import" || raw.source === "migration"
        ? raw.source
        : "manual",
  };
}

export function addressHasStreet(address: StructuredAddress) {
  return Boolean(address.street.trim() && address.city.trim() && address.state.trim() && address.postalCode.trim());
}

export function isLocationMode(value: unknown): value is LocationMode {
  return typeof value === "string" && (LOCATION_MODES as readonly string[]).includes(value);
}

export function locationLabel(mode: LocationMode, fallback = ""): string {
  if (mode === "at_business") return fallback || "At business";
  if (mode === "at_customer") return "At customer location";
  if (mode === "virtual") return fallback || "Virtual meeting";
  return fallback || "Custom location";
}

export function toDbAddress(address: StructuredAddress) {
  return {
    street: address.street,
    street2: address.street2,
    city: address.city,
    state: address.state,
    postal_code: address.postalCode,
    country: address.country,
    formatted: address.formatted || formatAddress(address),
    access_instructions: address.accessInstructions || "",
    validated: address.validated === true,
    smarty_key: address.smartyKey || "",
    source: address.source || "manual",
  };
}

export function fromDbAddress(row: Record<string, unknown>): StructuredAddress {
  return parseAddressInput({
    street: row.street,
    street2: row.street2,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    formatted: row.formatted,
    accessInstructions: row.access_instructions,
    validated: row.validated,
    smartyKey: row.smarty_key,
    source: row.source,
  });
}
