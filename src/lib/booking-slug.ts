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
