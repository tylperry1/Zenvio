import { getPool } from "./db";

/** Resolve a public booking host to the live profile slug (supports legacy aliases). */
export async function resolveBookingSlug(host: string): Promise<string | null> {
  const slug = host.trim().toLowerCase();
  if (!slug) return null;
  try {
    const row = (
      await getPool().query<{ resolve_booking_slug: string | null }>(
        "SELECT public.resolve_booking_slug($1) AS resolve_booking_slug",
        [slug],
      )
    ).rows[0];
    return row?.resolve_booking_slug || null;
  } catch {
    // Migration may not be applied yet; fall back to the requested host.
    return slug;
  }
}

/** Keep attribution and payment return params when redirecting a legacy host. */
export function bookingQueryString(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    } else if (value != null && value !== "") {
      query.set(key, value);
    }
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}
