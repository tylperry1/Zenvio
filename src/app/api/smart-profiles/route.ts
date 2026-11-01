import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, email, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { cardKinds, cleanLinks, cleanSlug, cleanWebsite, newCardToken } from "@/lib/smart-cards";

export const dynamic = "force-dynamic";
const MAX_PROFILES = 5;
const MAX_CARDS = 50;

export async function GET() {
  try {
    const { token: owner } = await session();
    const db = getPool();
    const [profiles, cards, views, booking] = await Promise.all([
      db.query("SELECT * FROM private.smart_profiles WHERE user_id=$1 ORDER BY created_at", [owner]),
      db.query("SELECT id,profile_id,token,label,kind,status,created_at,deactivated_at FROM private.smart_cards WHERE user_id=$1 ORDER BY created_at DESC", [owner]),
      db.query(
        `SELECT v.profile_id,v.channel,sum(v.views)::int views FROM private.smart_profile_views v
           JOIN private.smart_profiles p ON p.id=v.profile_id
          WHERE p.user_id=$1 AND v.day>=(now() AT TIME ZONE 'UTC')::date-29 GROUP BY 1,2`,
        [owner],
      ),
      db.query("SELECT slug FROM public.profiles WHERE id=$1", [owner]),
    ]);
    return Response.json(
      { profiles: profiles.rows, cards: cards.rows, views: views.rows, bookingSlug: booking.rows[0]?.slug || null, limits: { profiles: MAX_PROFILES, cards: MAX_CARDS } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token: owner } = await session();
    const input = await body(request);
    const db = getPool();
    const ownProfile = async (id: unknown) => {
      const pid = uuid(id);
      if (!(await db.query("SELECT 1 FROM private.smart_profiles WHERE id=$1 AND user_id=$2", [pid, owner])).rowCount) throw new ApiError("Profile not found.", 404);
      return pid;
    };

    if (input.action === "save-profile") {
      const f = {
        slug: cleanSlug(input.slug),
        display_name: string(input.display_name, "name", 100, 1).trim(),
        company: string(input.company ?? "", "company", 120, 0).trim(),
        job_title: string(input.job_title ?? "", "job title", 120, 0).trim(),
        bio: string(input.bio ?? "", "short bio", 500, 0).trim(),
        phone: string(input.phone ?? "", "phone", 40, 0).trim(),
        email: input.email ? email(input.email) : "",
        website: cleanWebsite(input.website),
        address: string(input.address ?? "", "address", 300, 0).trim(),
        links: JSON.stringify(cleanLinks(input.links)),
        show_booking: input.show_booking !== false,
        show_phone: input.show_phone !== false,
        show_email: input.show_email !== false,
        show_address: input.show_address === true,
        accent: typeof input.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(input.accent) ? input.accent : "#365cff",
        published: input.published !== false,
      };
      const keys = Object.keys(f);
      try {
        if (input.id) {
          const id = await ownProfile(input.id);
          await db.query(`UPDATE private.smart_profiles SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(",")},updated_at=now() WHERE id=$1 AND user_id=$2`, [id, owner, ...Object.values(f)]);
          return Response.json({ ok: true, id });
        }
        const count = (await db.query("SELECT count(*)::int n FROM private.smart_profiles WHERE user_id=$1", [owner])).rows[0].n;
        if (count >= MAX_PROFILES) throw new ApiError(`You can create up to ${MAX_PROFILES} profiles.`, 409);
        const r = await db.query(`INSERT INTO private.smart_profiles(user_id,${keys.join(",")}) VALUES($1,${keys.map((_, i) => `$${i + 2}`).join(",")}) RETURNING id`, [owner, ...Object.values(f)]);
        return Response.json({ ok: true, id: r.rows[0].id });
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new ApiError("That profile address is taken. Choose another.", 409);
        throw e;
      }
    }
    if (input.action === "delete-profile") {
      const id = await ownProfile(input.id);
      // Cards stay with the owner and simply stop pointing anywhere until reassigned.
      await db.query("DELETE FROM private.smart_profiles WHERE id=$1 AND user_id=$2", [id, owner]);
      return Response.json({ ok: true });
    }
    if (input.action === "create-card") {
      const profileId = await ownProfile(input.profileId);
      const kind = (cardKinds as readonly string[]).includes(String(input.kind)) ? String(input.kind) : "card";
      const count = (await db.query("SELECT count(*)::int n FROM private.smart_cards WHERE user_id=$1", [owner])).rows[0].n;
      if (count >= MAX_CARDS) throw new ApiError(`You can register up to ${MAX_CARDS} cards.`, 409);
      const token = newCardToken();
      await db.query("INSERT INTO private.smart_cards(user_id,profile_id,token,label,kind) VALUES($1,$2,$3,$4,$5)", [owner, profileId, token, string(input.label ?? "", "label", 80, 0).trim(), kind]);
      return Response.json({ ok: true, token });
    }
    if (input.action === "update-card") {
      const id = uuid(input.id);
      const profileId = input.profileId ? await ownProfile(input.profileId) : null;
      const status = input.status === "deactivated" ? "deactivated" : "active";
      const r = await db.query(
        `UPDATE private.smart_cards SET profile_id=$3,label=$4,status=$5,deactivated_at=CASE WHEN $5='deactivated' THEN coalesce(deactivated_at,now()) ELSE NULL END
          WHERE id=$1 AND user_id=$2`,
        [id, owner, profileId, string(input.label ?? "", "label", 80, 0).trim(), status],
      );
      if (!r.rowCount) throw new ApiError("Card not found.", 404);
      return Response.json({ ok: true });
    }
    throw new ApiError("Unknown action.");
  } catch (error) {
    return failure(error);
  }
}
