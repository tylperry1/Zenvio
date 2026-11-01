import { randomBytes } from "node:crypto";
import { ApiError } from "./server";

export type SmartLink = { label: string; url: string };
export type SmartProfile = {
  id: string;
  user_id: string;
  slug: string;
  display_name: string;
  company: string;
  job_title: string;
  bio: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  links: SmartLink[];
  show_booking: boolean;
  show_phone: boolean;
  show_email: boolean;
  show_address: boolean;
  accent: string;
  published: boolean;
};
export const cardKinds = ["card", "keychain", "sticker", "stand", "tag"] as const;
export const RESERVED_SLUGS = new Set(["admin", "api", "app", "new", "edit", "settings", "zenvio", "support", "help", "login"]);

/** Unpredictable 24-character card token (144 bits). */
export function newCardToken() {
  return randomBytes(18).toString("base64url");
}

export function cleanSlug(value: unknown) {
  if (typeof value !== "string") throw new ApiError("Choose a profile address.");
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,49}$/.test(slug) || slug.endsWith("-")) throw new ApiError("Profile addresses use 3–50 lowercase letters, numbers and dashes.");
  if (RESERVED_SLUGS.has(slug)) throw new ApiError("That address is reserved. Choose another.");
  return slug;
}

export function cleanLinks(value: unknown): SmartLink[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 8) throw new ApiError("Add up to 8 links.");
  return value.map((l) => {
    const label = typeof l?.label === "string" ? l.label.trim().slice(0, 40) : "";
    const url = typeof l?.url === "string" ? l.url.trim() : "";
    if (!label) throw new ApiError("Each link needs a label.");
    if (!/^https:\/\/[^\s]{3,490}$/i.test(url)) throw new ApiError(`“${label}” must be an https:// link.`);
    return { label, url };
  });
}

export function cleanWebsite(value: unknown) {
  const s = typeof value === "string" ? value.trim() : "";
  if (s && !/^https:\/\/[^\s]{3,490}$/i.test(s)) throw new ApiError("Website must start with https://");
  return s;
}

/** Fields a visitor may see, after the owner's privacy settings. */
export function publicView(p: SmartProfile, bookingSlug: string | null) {
  return {
    slug: p.slug,
    displayName: p.display_name,
    company: p.company,
    jobTitle: p.job_title,
    bio: p.bio,
    phone: p.show_phone ? p.phone : "",
    email: p.show_email ? p.email : "",
    address: p.show_address ? p.address : "",
    website: p.website,
    links: Array.isArray(p.links) ? p.links : [],
    bookingUrl: p.show_booking && bookingSlug ? `/book/${bookingSlug}?src=smart-card` : "",
    accent: p.accent,
  };
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => "\\" + m);
/** vCard 3.0 containing only the publicly visible fields. */
export function vcard(view: ReturnType<typeof publicView>, origin: string) {
  const [first, ...rest] = view.displayName.split(/\s+/);
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${esc(rest.join(" "))};${esc(first || "")};;;`,
    `FN:${esc(view.displayName)}`,
    view.company && `ORG:${esc(view.company)}`,
    view.jobTitle && `TITLE:${esc(view.jobTitle)}`,
    view.phone && `TEL;TYPE=WORK,VOICE:${esc(view.phone)}`,
    view.email && `EMAIL;TYPE=INTERNET:${esc(view.email)}`,
    view.website && `URL:${esc(view.website)}`,
    `URL;TYPE=Profile:${origin}/p/${view.slug}`,
    view.address && `ADR;TYPE=WORK:;;${esc(view.address)};;;;`,
    view.bio && `NOTE:${esc(view.bio)}`,
    "END:VCARD",
  ].filter(Boolean);
  return lines.join("\r\n") + "\r\n";
}

// ---------- Server-side loading (public pages) ----------
export async function loadPublicProfile(slug: string) {
  const { getPool } = await import("./db");
  if (!/^[a-z0-9][a-z0-9-]{2,49}$/.test(slug)) return null;
  const r = await getPool().query(
    `SELECT s.*,p.slug booking_slug FROM private.smart_profiles s LEFT JOIN public.profiles p ON p.id=s.user_id
      WHERE s.slug=$1 AND s.published`,
    [slug],
  );
  const row = r.rows[0];
  return row ? { id: row.id as string, view: publicView(row as SmartProfile, row.booking_slug) } : null;
}

/** Aggregate daily view count; throttled per client so counts can't be trivially inflated. */
export async function recordProfileView(profileId: string, channel: "link" | "card" | "qr", clientKey: string) {
  const [{ getPool }, { allowRequest }] = await Promise.all([import("./db"), import("./booking-protection")]);
  if (!(await allowRequest("smart-view", `${clientKey}:${profileId}`, 20, 3600))) return;
  await getPool().query(
    `INSERT INTO private.smart_profile_views(profile_id,day,channel,views) VALUES($1,(now() AT TIME ZONE 'UTC')::date,$2,1)
     ON CONFLICT (profile_id,day,channel) DO UPDATE SET views=smart_profile_views.views+1`,
    [profileId, channel],
  );
}
