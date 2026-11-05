import type { NextRequest } from "next/server";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { getPool } from "@/lib/db";
import { ApiError, body, email, failure, sameOrigin, string } from "@/lib/server";
import { loadPublicProfile } from "@/lib/smart-cards";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    sameOrigin(request);
    const profile = await loadPublicProfile((await params).slug.toLowerCase());
    if (!profile?.captureLeads) throw new ApiError("Contact sharing is unavailable.", 404);
    const ip = clientIp(request);
    if (!(await allowRequest("smart-leads-ip", ip, 12, 3600)) ||
        !(await allowRequest("smart-leads-profile", profile.id, 60, 3600))) {
      throw new ApiError("Too many submissions. Please try again later.", 429);
    }
    const input = await body(request);
    if (input.website) return Response.json({ ok: true });
    if (input.consent !== true) throw new ApiError("Confirm that you want to share your details.");
    const name = string(input.name, "name", 100);
    const address = email(input.email);
    const company = string(input.company ?? "", "company", 100, 0);
    const result = await getPool().query(
      `WITH profile AS MATERIALIZED (
         SELECT id,user_id FROM private.smart_profiles WHERE id=$1 AND published AND capture_leads FOR UPDATE
       ), contact AS (
         INSERT INTO public.contacts(user_id,name,email,company)
         SELECT user_id,$2,$3,$4 FROM profile
         ON CONFLICT(user_id,email) DO UPDATE SET email=excluded.email
         RETURNING id
       ), attributed AS (
         INSERT INTO private.smart_profile_leads(profile_id,contact_id)
         SELECT profile.id,contact.id FROM profile CROSS JOIN contact ON CONFLICT DO NOTHING
       )
       SELECT id FROM contact`,
      [profile.id, name, address, company],
    );
    if (!result.rowCount) throw new ApiError("Contact sharing is unavailable.", 404);
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
