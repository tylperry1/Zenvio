import { publishedProfileDesign } from "@/lib/profile-design-store";
import { NextRequest } from "next/server";
import { ApiError, backend, failure, publicHostSlug } from "@/lib/server";
import { getPool } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const host = publicHostSlug(request.nextUrl.searchParams.get("host"));
    const profile = await backend("/rest/v1/rpc/public_profile", {
      method: "POST",
      body: JSON.stringify({ host_slug: host }),
    });
    if (!profile)
      throw new ApiError("This booking profile is unavailable.", 404);
    const liveSlug = String(profile.profile?.slug || host);
    const extra = (
      await getPool().query(
        `SELECT p.id,website,location,social_links,booking_instructions,
                EXISTS(SELECT 1 FROM private.profile_images i WHERE i.user_id=p.id AND i.kind='cover') has_cover,
                EXISTS(SELECT 1 FROM private.profile_images i WHERE i.user_id=p.id AND i.kind='logo') has_logo
           FROM public.profiles p WHERE p.slug=$1`,
        [liveSlug],
      )
    ).rows[0];
    const design=extra?await publishedProfileDesign(extra.id,"booking",extra.id):null;
    const {id: _privateId,...publicExtra}=extra||{};
    const modeRows = extra
      ? (
          await getPool().query(
            `SELECT slug, location_mode FROM public.event_types
              WHERE user_id=$1 AND active AND deleted_at IS NULL`,
            [extra.id],
          )
        ).rows
      : [];
    const modeBySlug = Object.fromEntries(modeRows.map((r) => [r.slug, r.location_mode]));
    const events = Array.isArray(profile.events)
      ? profile.events.map((e: { slug: string }) => ({
          ...e,
          location_mode: modeBySlug[e.slug] || null,
        }))
      : profile.events;
    return Response.json(
      {
        ...profile,
        events,
        design,
        profile: { ...profile.profile, ...publicExtra },
        redirect_to: liveSlug !== host ? liveSlug : undefined,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
