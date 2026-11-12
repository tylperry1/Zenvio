import type { PoolClient } from "pg";
import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, email, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { cardKinds, cleanCardDestination, cleanLinks, cleanSlug, cleanWebsite, newCardToken } from "@/lib/smart-cards";

import { configuredWallets } from "@/lib/smart-wallet";

export const dynamic = "force-dynamic";
const MAX_PROFILES = 5;
const MAX_CARDS = 50;

async function serialRegistration<T>(owner: string, run: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query('SELECT id FROM public."user" WHERE id=$1 FOR UPDATE', [owner]);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function GET(request: NextRequest) {
  try {
    const { token: owner } = await session();
    const db = getPool();
    const days = Number(request.nextUrl.searchParams.get("days") ?? 30);
    if (![7, 30, 90].includes(days)) throw new ApiError("Choose a 7, 30 or 90 day period.");
    const [profiles, cards, views, booking, engagement, wallet] = await Promise.all([
      db.query("SELECT * FROM private.smart_profiles WHERE user_id=$1 ORDER BY created_at", [owner]),
      db.query("SELECT id,profile_id,token,label,kind,status,created_at,deactivated_at,encoding_confirmed_at,legacy_registration,destination_kind,destination_url FROM private.smart_cards WHERE user_id=$1 ORDER BY created_at DESC", [owner]),
      db.query(
        `SELECT v.profile_id,v.channel,sum(v.views)::int views FROM private.smart_profile_views v
           JOIN private.smart_profiles p ON p.id=v.profile_id
          WHERE p.user_id=$1 AND v.day>=(now() AT TIME ZONE 'UTC')::date-($2::int-1) GROUP BY 1,2`,
        [owner, days],
      ),
      db.query("SELECT slug FROM public.profiles WHERE id=$1", [owner]),
      db.query(
        `SELECT a.profile_id,a.action,sum(a.total)::int total FROM private.smart_profile_actions a
           JOIN private.smart_profiles p ON p.id=a.profile_id WHERE p.user_id=$1
           AND a.day>=(now() AT TIME ZONE 'UTC')::date-($2::int-1) GROUP BY 1,2
         UNION ALL
         SELECT l.profile_id,'lead',count(*)::int FROM private.smart_profile_leads l
           JOIN private.smart_profiles p ON p.id=l.profile_id WHERE p.user_id=$1
           AND l.first_submitted_at >= ((now() AT TIME ZONE 'UTC')::date-($2::int-1)) AT TIME ZONE 'UTC' GROUP BY 1`,
        [owner, days],
      ),
      configuredWallets(),
    ]);
    return Response.json(
      { wallet, profiles: profiles.rows, cards: cards.rows, views: views.rows, engagement: engagement.rows, bookingSlug: booking.rows[0]?.slug || null, limits: { profiles: MAX_PROFILES, cards: MAX_CARDS } },
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
        slug: input.id ? null : cleanSlug(input.slug),
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
        published: input.published === true,
        capture_leads: input.capture_leads === true,
      };
      const entries = Object.entries(f).filter(([key]) => key !== "slug" || !input.id);
      const keys = entries.map(([key]) => key);
      const values = entries.map(([, value]) => value);
      try {
        if (input.id) {
          const id = await ownProfile(input.id);
          const result = await db.query(`UPDATE private.smart_profiles SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(",")},updated_at=now() WHERE id=$1 AND user_id=$2 AND archived_at IS NULL`, [id, owner, ...values]);
          if (!result.rowCount) throw new ApiError("Archived profiles cannot be edited.", 409);
          return Response.json({ ok: true, id });
        }
        return await serialRegistration(owner, async (client) => {
          const count = (await client.query("SELECT count(*)::int n FROM private.smart_profiles WHERE user_id=$1 AND archived_at IS NULL", [owner])).rows[0].n;
          if (count >= MAX_PROFILES) throw new ApiError(`You can create up to ${MAX_PROFILES} profiles.`, 409);
          const r = await client.query(`INSERT INTO private.smart_profiles(user_id,${keys.join(",")}) VALUES($1,${keys.map((_, i) => `$${i + 2}`).join(",")}) RETURNING id`, [owner, ...values]);
          return Response.json({ ok: true, id: r.rows[0].id });
        });
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new ApiError("That profile address is taken. Choose another.", 409);
        throw e;
      }
    }
    if (input.action === "archive-profile" || input.action === "delete-profile") {
      const id = await ownProfile(input.id);
      // Reserve the original slug and leave linked tokens intact.
      await db.query("UPDATE private.smart_profiles SET published=false,archived_at=coalesce(archived_at,now()),updated_at=now() WHERE id=$1 AND user_id=$2", [id, owner]);
      return Response.json({ ok: true });
    }
    if (input.action === "create-card") {
      const profileId = await ownProfile(input.profileId);
      const kind = (cardKinds as readonly string[]).includes(String(input.kind)) ? String(input.kind) : "card";
      const token = newCardToken();
      const label = string(input.label ?? "", "label", 80, 0);
      return await serialRegistration(owner, async (client) => {
        const count = (await client.query("SELECT count(*)::int n FROM private.smart_cards WHERE user_id=$1", [owner])).rows[0].n;
        if (count >= MAX_CARDS) throw new ApiError(`You can register up to ${MAX_CARDS} cards.`, 409);
        const created = await client.query(
          `WITH linked AS (
             SELECT id FROM private.smart_profiles WHERE id=$2 AND user_id=$1 AND archived_at IS NULL FOR UPDATE
           ), card AS (
             INSERT INTO private.smart_cards(user_id,profile_id,token,label,kind,status,deactivated_at)
             SELECT $1,id,$3,$4,$5,'deactivated',now() FROM linked RETURNING id,profile_id,status
           )
           INSERT INTO private.smart_card_activity(card_id,action,profile_id,status)
           SELECT id,'registered',profile_id,status FROM card`,
          [owner, profileId, token, label, kind],
        );
        if (!created.rowCount) throw new ApiError("Choose a profile that is not archived.", 409);
        return Response.json({ ok: true, token });
      });
    }
    if (input.action === "card-destination") {
      const destination=cleanCardDestination(input.destinationKind,input.destinationUrl);
      const r=await db.query(`WITH card AS (
        UPDATE private.smart_cards SET destination_kind=$3,destination_url=$4 WHERE id=$1 AND user_id=$2 RETURNING id,profile_id,status
      ) INSERT INTO private.smart_card_activity(card_id,action,profile_id,status) SELECT id,'updated',profile_id,status FROM card`,[uuid(input.id),owner,destination.kind,destination.url]);
      if(!r.rowCount) throw new ApiError("Card not found.",404);
      await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'nfc_destination_updated',$2)",[owner,JSON.stringify({cardId:input.id,kind:destination.kind})]);
      return Response.json({ok:true});
    }
    if (input.action === "update-card") {
      const id = uuid(input.id);
      const profileId = input.profileId ? await ownProfile(input.profileId) : null;
      const status = input.status === "active" ? "active" : "deactivated";
      const confirmed = input.confirmEncoding === true && status === "active";
      const r = await db.query(
        `WITH card AS (
           UPDATE private.smart_cards
           SET profile_id=$3,label=$4,status=$5,
               deactivated_at=CASE WHEN $5='deactivated' THEN coalesce(deactivated_at,now()) ELSE NULL END,
               encoding_confirmed_at=CASE WHEN $6 THEN coalesce(encoding_confirmed_at,now()) ELSE encoding_confirmed_at END
           WHERE id=$1 AND user_id=$2
             AND ($5='deactivated' OR (
               ($6 OR encoding_confirmed_at IS NOT NULL OR legacy_registration)
               AND EXISTS (SELECT 1 FROM private.smart_profiles WHERE id=$3 AND user_id=$2 AND archived_at IS NULL)
             ))
           RETURNING id,profile_id,status
         )
         INSERT INTO private.smart_card_activity(card_id,action,profile_id,status)
         SELECT id,CASE WHEN $6 THEN 'encoding_confirmed' ELSE 'updated' END,profile_id,status FROM card`,
        [id, owner, profileId, string(input.label ?? "", "label", 80, 0), status, confirmed],
      );
      if (!r.rowCount) throw new ApiError("Unable to update this card. Confirm encoding and select a current profile.", 409);
      return Response.json({ ok: true });
    }
    throw new ApiError("Unknown action.");
  } catch (error) {
    return failure(error);
  }
}
