import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import {
  session,
  body,
  sameOrigin,
  failure,
  uuid,
  string,
  email,
  ApiError,
} from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const { token } = await session(),
      id = req.nextUrl.searchParams.get("id");
    if (!id) {
      const params = req.nextUrl.searchParams,
        search =
          "%" + string(params.get("q") || "", "search", 100, 0).replace(/[\\%_]/g, "\\$&") + "%";
      if (params.get("export") === "csv") {
        const r = await getPool().query(
          `SELECT c.name,c.email,c.company,c.notes,c.created_at,count(b.id) FILTER (WHERE b.status='confirmed')::int appointments
             FROM public.contacts c LEFT JOIN public.bookings b ON b.contact_id=c.id AND b.user_id=c.user_id
            WHERE c.user_id=$1 GROUP BY c.id ORDER BY c.name LIMIT 50000`,
          [token],
        );
        // Prefix cells that spreadsheet apps would evaluate as formulas.
        const cell = (v: unknown) => {
          let text = v instanceof Date ? v.toISOString() : String(v ?? "");
          if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
          return '"' + text.replaceAll('"', '""') + '"';
        };
        const csv = [
          ["Name", "Email", "Company", "Notes", "Added", "Appointments"],
          ...r.rows.map((c) => [c.name, c.email, c.company, c.notes, c.created_at, c.appointments]),
        ]
          .map((row) => row.map(cell).join(","))
          .join("\r\n");
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="zenvio-clients.csv"',
            "Cache-Control": "no-store",
          },
        });
      }
      const r = await getPool().query(
        `SELECT c.*,count(b.id) FILTER (WHERE b.status='confirmed')::int appointments,
                max(b.starts_at) FILTER (WHERE b.status='confirmed') last_appointment,
                count(*) OVER()::int total
           FROM public.contacts c LEFT JOIN public.bookings b ON b.contact_id=c.id AND b.user_id=c.user_id
          WHERE c.user_id=$1 AND (c.name ILIKE $2 OR c.email ILIKE $2 OR c.company ILIKE $2)
          GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50 OFFSET $3`,
        [
          token,
          search,
          Math.max(0, Math.min(10000, Number(params.get("page") || 0) || 0)) * 50,
        ],
      );
      return Response.json(
        { contacts: r.rows, total: r.rows[0]?.total ?? 0, pageSize: 50 },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const c = (
      await getPool().query(
        "SELECT * FROM public.contacts WHERE id=$1 AND user_id=$2",
        [uuid(id), token],
      )
    ).rows[0];
    if (!c) throw new ApiError("Client not found.", 404);
    const [bookings, envelopes, payments, deliveries, tasks, addresses] =
      await Promise.all([
        getPool().query(
          "SELECT b.id,e.title,b.starts_at,b.ends_at,b.status,b.notes,b.intake_snapshot,b.location,b.location_mode,b.service_address,b.access_instructions,b.guest_phone FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id WHERE b.contact_id=$1 AND b.user_id=$2 ORDER BY starts_at DESC",
          [id, token],
        ),
        getPool().query(
          `SELECT e.id,e.title,e.status,e.created_at,e.completed_at,(SELECT jsonb_agg(jsonb_build_object('name',r.name,'status',r.status)) FROM private.signature_recipients r WHERE r.envelope_id=e.id) recipients FROM private.signature_envelopes e WHERE contact_id=$1 AND user_id=$2 ORDER BY created_at DESC`,
          [id, token],
        ),
        getPool().query(
          "SELECT p.id,p.status,p.amount_cents,p.total_cents,p.refunded_cents,p.currency,p.created_at FROM private.appointment_payments p JOIN public.bookings b ON b.id=p.booking_id WHERE b.contact_id=$1 AND p.user_id=$2",
          [id, token],
        ),
        getPool().query(
          "SELECT j.id,j.subject,j.status,j.kind,j.sent_at,j.created_at FROM private.delivery_jobs j LEFT JOIN public.bookings b ON b.id=j.booking_id LEFT JOIN private.signature_envelopes e ON e.id=j.envelope_id WHERE j.user_id=$2 AND (b.contact_id=$1 OR e.contact_id=$1) ORDER BY j.created_at DESC LIMIT 100",
          [id, token],
        ),
        getPool().query(
          "SELECT * FROM private.client_tasks WHERE user_id=$2 AND contact_id=$1",
          [id, token],
        ),
        getPool().query(
          `SELECT id,address_type,street,street2,city,state,postal_code,country,formatted,access_instructions,validated,source,updated_at
             FROM private.addresses
            WHERE workspace_id=$2 AND contact_id=$1
            ORDER BY address_type, updated_at DESC`,
          [id, token],
        ),
      ]);
    const textDocuments = (
      await getPool().query(
        "SELECT id,title,status,created_at,signed_at FROM private.signing_documents WHERE contact_id=$1 AND user_id=$2",
        [id, token],
      )
    ).rows;
    const unlinked = (
      await getPool().query(
        "SELECT e.id,e.title,'pdf' kind,string_agg(r.name||' <'||r.email||'>',', ') recipients FROM private.signature_envelopes e JOIN private.signature_recipients r ON r.envelope_id=e.id WHERE e.user_id=$1 AND e.contact_id IS NULL GROUP BY e.id UNION ALL SELECT id,title,'text' kind,recipient_name||' <'||recipient_email||'>' recipients FROM private.signing_documents WHERE user_id=$1 AND contact_id IS NULL LIMIT 100",
        [token],
      )
    ).rows;
    const activity = (
      await getPool().query(
        "SELECT action,created_at FROM private.client_activity WHERE user_id=$2 AND contact_id=$1 UNION ALL SELECT a.action,a.created_at FROM private.booking_activity a JOIN public.bookings b ON b.id=a.booking_id WHERE b.user_id=$2 AND b.contact_id=$1 UNION ALL SELECT s.action,s.created_at FROM private.signature_events s JOIN private.signature_envelopes e ON e.id=s.envelope_id WHERE e.user_id=$2 AND e.contact_id=$1 ORDER BY created_at DESC LIMIT 200",
        [id, token],
      )
    ).rows;
    const refunds = (
      await getPool().query(
        "SELECT r.id,r.amount_cents,r.status,r.reason,r.created_at FROM private.appointment_refunds r JOIN private.appointment_payments p ON p.id=r.payment_id JOIN public.bookings b ON b.id=p.booking_id WHERE p.user_id=$2 AND b.contact_id=$1 ORDER BY r.created_at DESC",
        [id, token],
      )
    ).rows;
    return Response.json(
      {
        activity,
        refunds,
        textDocuments,
        unlinked,
        contact: c,
        addresses: addresses.rows,
        bookings: bookings.rows,
        envelopes: envelopes.rows,
        payments: payments.rows,
        deliveries: deliveries.rows,
        tasks: tasks.rows,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      return failure(
        new ApiError(
          "A client with this email already exists. Review the existing record; no contacts were merged.",
          409,
        ),
      );
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token } = await session(),
      v = await body(req),
      id = uuid(v.id);
    if (
      !(
        await getPool().query(
          "SELECT 1 FROM public.contacts WHERE id=$1 AND user_id=$2",
          [id, token],
        )
      ).rowCount
    )
      throw new ApiError("Client not found.", 404);
    if (v.action === "edit") {
      await getPool().query(
        "UPDATE public.contacts SET name=$3,email=$4,company=$5,notes=$6,phone=$7,address=$8 WHERE id=$1 AND user_id=$2",
        [
          id,
          token,
          string(v.name, "name", 100),
          email(v.email),
          string(v.company || "", "company", 100, 0),
          string(v.notes || "", "notes", 2000, 0),
          string(v.phone || "", "phone", 40, 0),
          string(v.address || "", "address", 500, 0),
        ],
      );
      // Typed residential/billing updates are explicit; never overwrite from appointment service addresses.
      // null payload = clear that typed address; omit/undefined leaves it unchanged.
      if ("residentialAddress" in v || "billingAddress" in v) {
        const { parseAddressInput, toDbAddress } = await import("@/lib/addresses");
        for (const [type, payload] of [
          ["residential", v.residentialAddress],
          ["billing", v.billingAddress],
        ] as const) {
          if (payload === undefined) continue;
          if (payload === null) {
            await getPool().query(
              "DELETE FROM private.addresses WHERE contact_id=$1 AND address_type=$2 AND workspace_id=$3",
              [id, type, token],
            );
            if (type === "residential")
              await getPool().query(
                "UPDATE public.contacts SET address='' WHERE id=$1 AND user_id=$2",
                [id, token],
              );
            continue;
          }
          const parsed = parseAddressInput(payload);
          const row = toDbAddress(parsed);
          const existing = (
            await getPool().query(
              "SELECT id FROM private.addresses WHERE contact_id=$1 AND address_type=$2 LIMIT 1",
              [id, type],
            )
          ).rows[0];
          if (existing) {
            await getPool().query(
              `UPDATE private.addresses SET street=$2,street2=$3,city=$4,state=$5,postal_code=$6,country=$7,
                 formatted=$8,access_instructions=$9,validated=$10,smarty_key=$11,source=$12,updated_at=now()
               WHERE id=$1`,
              [
                existing.id,
                row.street,
                row.street2,
                row.city,
                row.state,
                row.postal_code,
                row.country,
                row.formatted,
                row.access_instructions,
                row.validated,
                row.smarty_key,
                row.source,
              ],
            );
          } else {
            await getPool().query(
              `INSERT INTO private.addresses(
                 workspace_id,contact_id,address_type,street,street2,city,state,postal_code,country,
                 formatted,access_instructions,validated,smarty_key,source
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
              [
                token,
                id,
                type,
                row.street,
                row.street2,
                row.city,
                row.state,
                row.postal_code,
                row.country,
                row.formatted,
                row.access_instructions,
                row.validated,
                row.smarty_key,
                row.source,
              ],
            );
          }
          if (type === "residential" && row.formatted)
            await getPool().query(
              "UPDATE public.contacts SET address=$2 WHERE id=$1 AND user_id=$3",
              [id, row.formatted.slice(0, 500), token],
            );
        }
      }
    }
    else if (v.action === "link_envelope") {
      const r = await getPool().query(
        "UPDATE private.signature_envelopes SET contact_id=$3 WHERE id=$1 AND user_id=$2 AND (contact_id IS NULL OR contact_id=$3) RETURNING id",
        [uuid(v.envelope_id), token, id],
      );
      if (!r.rowCount)
        throw new ApiError(
          "Document unavailable or already linked to another client.",
          409,
        );
    } else if (v.action === "link_text") {
      const r = await getPool().query(
        "UPDATE private.signing_documents SET contact_id=$3 WHERE id=$1 AND user_id=$2 AND (contact_id IS NULL OR contact_id=$3) RETURNING id",
        [uuid(v.document_id), token, id],
      );
      if (!r.rowCount)
        throw new ApiError("Agreement unavailable or already linked.", 409);
    } else if (v.action === "task")
      await getPool().query(
        "INSERT INTO private.client_tasks(user_id,contact_id,title) VALUES($1,$2,$3)",
        [token, id, string(v.title, "task", 200)],
      );
    else if (v.action === "complete_task")
      await getPool().query(
        "UPDATE private.client_tasks SET completed=$4 WHERE id=$1 AND user_id=$2 AND contact_id=$3",
        [uuid(v.task_id), token, id, v.completed === true],
      );
    else throw new ApiError("Invalid action.");
    await getPool().query(
      "INSERT INTO private.client_activity(user_id,contact_id,action) VALUES($1,$2,$3)",
      [token, id, String(v.action)],
    );
    return Response.json({ ok: true });
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      return failure(
        new ApiError(
          "A client with this email already exists. Review the existing record; no contacts were merged.",
          409,
        ),
      );
    return failure(e);
  }
}
