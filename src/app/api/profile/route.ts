import { publishedProfileDesign } from "@/lib/profile-design-store";
import { NextRequest } from "next/server";
import { ApiError, backend, failure, slug } from "@/lib/server";
import { getPool } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const host = slug(request.nextUrl.searchParams.get("host"));
    const profile = await backend("/rest/v1/rpc/public_profile", {
      method: "POST",
      body: JSON.stringify({ host_slug: host }),
    });
    if (!profile)
      throw new ApiError("This booking profile is unavailable.", 404);
    const extra = (
      await getPool().query(
        `SELECT p.id,website,location,social_links,booking_instructions,
                EXISTS(SELECT 1 FROM private.profile_images i WHERE i.user_id=p.id AND i.kind='cover') has_cover,
                EXISTS(SELECT 1 FROM private.profile_images i WHERE i.user_id=p.id AND i.kind='logo') has_logo
           FROM public.profiles p WHERE p.slug=$1`,
        [host],
      )
    ).rows[0];
    const design=extra?await publishedProfileDesign(extra.id,"booking",extra.id):null;
    const {id: _privateId,...publicExtra}=extra||{};
    return Response.json(
      { ...profile, design, profile: { ...profile.profile, ...publicExtra } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
