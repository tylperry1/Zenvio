import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { body, failure, sameOrigin, session } from "@/lib/server";
import { profileDetails } from "@/lib/profile-details";
export const dynamic = "force-dynamic";

// Booking-page personalization beyond the basic profile: links, location, instructions,
// images and the business type that turns on contractor tools.
export async function GET() {
  try {
    const { user } = await session();
    const { rows } = await getPool().query(
      `SELECT website,location,social_links,booking_instructions,industry,
              EXISTS(SELECT 1 FROM private.profile_images i WHERE i.user_id=p.id AND i.kind='cover') has_cover,
              EXISTS(SELECT 1 FROM private.profile_images i WHERE i.user_id=p.id AND i.kind='logo') has_logo
         FROM public.profiles p WHERE p.id=$1`,
      [user.id],
    );
    return Response.json(rows[0] || {}, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session();
    const input = await body(request);
    if (input.action === "industry") {
      // Onboarding sets only the business type.
      const industry = profileDetails({ industry: input.industry }).industry;
      await getPool().query("UPDATE public.profiles SET industry=$2 WHERE id=$1", [user.id, industry]);
      return Response.json({ ok: true, industry });
    }
    const v = profileDetails(input);
    await getPool().query(
      "UPDATE public.profiles SET website=$2,location=$3,booking_instructions=$4,social_links=$5,industry=$6 WHERE id=$1",
      [user.id, v.website, v.location, v.booking_instructions, JSON.stringify(v.social_links), v.industry],
    );
    return Response.json({ ok: true, ...v });
  } catch (e) {
    return failure(e);
  }
}
