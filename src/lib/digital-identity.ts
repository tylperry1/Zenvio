import { ApiError } from "./server";

/** Canonical Digital Identity kinds supported by Zenvio. */
export const PROFILE_KINDS = ["individual", "business", "employee", "team", "brand"] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

export const PROFILE_VISIBILITIES = ["public", "unlisted", "private"] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

export const VIEW_CHANNELS = ["link", "card", "qr", "nfc"] as const;
export type ViewChannel = (typeof VIEW_CHANNELS)[number];

export const PROFILE_ACTIONS = [
  "vcard",
  "booking",
  "phone",
  "email",
  "website",
  "social",
  "share",
  "copy_link",
] as const;
export type ProfileAction = (typeof PROFILE_ACTIONS)[number];

/**
 * Capacity ceilings for Digital Identity products.
 * These mirror the long-standing Smart Cards caps and do NOT invent plan prices.
 * When a future catalog meter lands, resolve through entitlements without changing Stripe prices here.
 */
export const DIGITAL_IDENTITY_LIMITS = {
  profiles: 5,
  cards: 50,
  nfcTags: 100,
} as const;

export function cleanProfileKind(value: unknown): ProfileKind {
  if (typeof value !== "string" || !(PROFILE_KINDS as readonly string[]).includes(value)) {
    throw new ApiError("Choose a profile type: individual, business, employee, team, or brand.");
  }
  return value as ProfileKind;
}

export function cleanVisibility(value: unknown): ProfileVisibility {
  if (typeof value !== "string" || !(PROFILE_VISIBILITIES as readonly string[]).includes(value)) {
    throw new ApiError("Choose visibility: public, unlisted, or private.");
  }
  return value as ProfileVisibility;
}

/** Publishing status derived from visibility (private ⇒ unpublished). */
export function publishedFromVisibility(visibility: ProfileVisibility, publishedFlag?: boolean) {
  if (visibility === "private") return false;
  if (publishedFlag === false) return false;
  return visibility === "public" || visibility === "unlisted";
}

/** Public path for a Digital Identity — the single canonical profile URL. */
export function canonicalProfilePath(slug: string) {
  return `/p/${slug}`;
}

/** Absolute canonical URL for QR/NFC/share surfaces. */
export function canonicalProfileUrl(origin: string, slug: string, via?: ViewChannel) {
  const base = new URL(canonicalProfilePath(slug), origin.replace(/\/$/, "") + "/");
  if (via) base.searchParams.set("via", via);
  return base.toString();
}

/**
 * Physical products encode the stable card redirect, optionally marking NFC source.
 * Content edits never require reprogramming — /c/{token} always resolves to the linked profile.
 */
export function canonicalCardUrl(origin: string, token: string, source: "card" | "nfc" = "card") {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) throw new ApiError("Invalid Smart Card token.");
  const url = new URL(`/c/${token}`, origin.replace(/\/$/, "") + "/");
  if (source === "nfc") url.searchParams.set("src", "nfc");
  return url.toString();
}

export function upgradeMessageFor(limit: keyof typeof DIGITAL_IDENTITY_LIMITS) {
  const labels = {
    profiles: "digital profiles",
    cards: "Smart Cards",
    nfcTags: "NFC tags",
  } as const;
  return `You’ve reached the included ${labels[limit]} allowance (${DIGITAL_IDENTITY_LIMITS[limit]}). Open Plan & billing to review your workspace capacity, or archive unused items.`;
}

/** Map ?via / ?src query values to a view channel without inventing analytics. */
export function resolveViewChannel(via?: string | null, src?: string | null): ViewChannel {
  if (via === "qr" || src === "qr") return "qr";
  if (via === "nfc" || src === "nfc") return "nfc";
  if (via === "card" || src === "card") return "card";
  return "link";
}
