import { NextRequest, after } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, email, failure, sameOrigin, slug, string, uuid } from "@/lib/server";
import { protectBooking, captchaSiteKey } from "@/lib/booking-protection";
import { contractorIndustry, industryInfo } from "@/lib/contractor";
import { claimUploads, uploadKey } from "@/lib/guest-uploads";
import { appOrigin, drainDeliveries, queueDelivery } from "@/lib/lifecycle";
export const dynamic = "force-dynamic";

async function host(value: unknown) {
  const p = (
    await getPool().query("SELECT id,name,company,slug,accent_color,industry FROM public.profiles WHERE slug=$1", [slug(value)])
  ).rows[0];
  // Service requests exist only for businesses that chose a trade preset.
  if (!p || !contractorIndustry(p.industry)) throw new ApiError("This request page is unavailable.", 404);
  return p;
}

export async function GET(request: NextRequest) {
  try {
    const p = await host(request.nextUrl.searchParams.get("host"));
    return Response.json(
      {
        business: p.company || p.name,
        slug: p.slug,
        accent: p.accent_color,
        industry: industryInfo(p.industry).label,
        categories: industryInfo(p.industry).categories,
        captchaSiteKey: await captchaSiteKey(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = await body(request);
    if (input.website) return Response.json({ error: "Unable to submit request." }, { status: 400 });
    await protectBooking(request, input.captcha);
    const p = await host(input.host);
    const categories: readonly string[] = industryInfo(p.industry).categories;
    const category = string(input.category, "service category", 80);
    if (!categories.includes(category)) throw new ApiError("Choose a service category.");
    const name = string(input.name, "name", 100, 2),
      address = string(input.address, "job site address", 300, 5),
      description = string(input.description, "problem description", 4000, 10),
      phone = string(input.phone ?? "", "phone number", 40, 0),
      preferred = string(input.preferredTime ?? "", "preferred time", 200, 0),
      guestEmail = email(input.email);
    if (phone && !/^\+?[\d\s().-]{7,25}$/.test(phone)) throw new ApiError("Enter a valid phone number.");
    const ids = Array.isArray(input.photos) ? input.photos.slice(0, 10).map(uuid) : [];
    const db = await getPool().connect();
    let jobId: string;
    try {
      await db.query("BEGIN");
      const contact = (
        await db.query(
          `INSERT INTO public.contacts(user_id,name,email) VALUES($1,$2,$3)
           ON CONFLICT(user_id,email) DO UPDATE SET name=public.contacts.name RETURNING id`,
          [p.id, name, guestEmail],
        )
      ).rows[0].id;
      jobId = (
        await db.query(
          `INSERT INTO private.jobs(user_id,contact_id,title,category,address,description,preferred_time,status,source)
           VALUES($1,$2,$3,$4,$5,$6,$7,'requested','request_form') RETURNING id`,
          [p.id, contact, `${category} — ${name}`.slice(0, 120), category, address, description, [preferred, phone && `Phone: ${phone}`].filter(Boolean).join(" · ").slice(0, 200)],
        )
      ).rows[0].id;
      if (ids.length) await claimUploads(db, { hostId: p.id, ids, key: uploadKey(input.uploadKey), jobId });
      await db.query("INSERT INTO private.job_activity(job_id,action) VALUES($1,$2)", [
        jobId,
        `Service request submitted online${ids.length ? ` with ${ids.length} file${ids.length === 1 ? "" : "s"}` : ""}`,
      ]);
      await db.query("INSERT INTO private.client_activity(user_id,contact_id,action) VALUES($1,$2,'Submitted a service request')", [p.id, contact]);
      const owner = (await db.query('SELECT email FROM public."user" WHERE id=$1', [p.id])).rows[0];
      if (owner)
        await queueDelivery(db, {
          user: p.id,
          kind: "service_request",
          key: "service-request:" + jobId,
          to: owner.email,
          subject: `New service request: ${category}`,
          text: `You have a new ${category.toLowerCase()} request from ${name}.\n\nReview it: ${appOrigin()}/app/jobs?job=${jobId}`,
        });
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
    after(() => drainDeliveries(p.id, 2).then(() => {}));
    return Response.json({ ok: true, business: p.company || p.name }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
