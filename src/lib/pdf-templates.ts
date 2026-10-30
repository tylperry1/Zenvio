import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { ApiError, string, email } from "./server";
import { fieldsInput } from "./envelopes";
export async function instantiateTemplate(
  db: PoolClient,
  user: string,
  template: string,
  assignments: unknown,
  contact: string | null = null,
  booking: string | null = null,
) {
  // Drafts do not use signing allowance; retain a separate storage abuse limit.
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["envelope-upload:"+user]);
  const drafts = (await db.query("SELECT count(*)::int n FROM private.signature_envelopes WHERE user_id=$1 AND created_at>now()-interval '24 hours'",[user])).rows[0];
  if (drafts.n >= 30) throw new ApiError("Daily document limit reached. Try again tomorrow.",429);
  const t = (
    await db.query(
      "SELECT t.id,t.name,v.* FROM private.pdf_templates t JOIN private.pdf_template_versions v ON v.template_id=t.id AND v.version=t.current_version WHERE t.id=$1 AND t.user_id=$2 AND NOT t.archived FOR SHARE OF t",
      [template, user],
    )
  ).rows[0];
  if (!t) throw new ApiError("Template unavailable.", 404);
  if (!Array.isArray(assignments) || assignments.length !== t.roles.length)
    throw new ApiError("Assign a recipient to every template role.");
  const rows = t.roles.map((role: string, i: number) => ({
    id: randomUUID(),
    role,
    name: string(assignments[i].name, "recipient name", 100, 2),
    email: email(assignments[i].email),
  }));
  if (new Set(rows.map((r: any) => r.email)).size !== rows.length)
    throw new ApiError("Use a distinct email for each role.");
  if (
    contact &&
    !(
      await db.query(
        "SELECT 1 FROM public.contacts WHERE id=$1 AND user_id=$2",
        [contact, user],
      )
    ).rowCount
  )
    throw new ApiError("Client not found.", 404);
  if (
    booking &&
    !(
      await db.query(
        "SELECT 1 FROM public.bookings WHERE id=$1 AND user_id=$2",
        [booking, user],
      )
    ).rowCount
  )
    throw new ApiError("Appointment not found.", 404);
  const fields = fieldsInput(
    t.fields.map((f: any) => ({ ...f, recipient: rows[f.role]?.id })),
    rows,
    t.pages.length,
  );
  const e = (
    await db.query(
      "INSERT INTO private.signature_envelopes(user_id,title,message,pdf,pages,fields,contact_id,booking_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [
        user,
        t.name,
        t.message,
        t.pdf,
        JSON.stringify(t.pages),
        JSON.stringify(fields),
        contact,
        booking,
      ],
    )
  ).rows[0];
  for (const r of rows)
    await db.query(
      "INSERT INTO private.signature_recipients(id,envelope_id,name,email) VALUES($1,$2,$3,$4)",
      [r.id, e.id, r.name, r.email],
    );
  await db.query(
    "INSERT INTO private.signature_events(envelope_id,action,details) VALUES($1,'created_from_template',$2)",
    [e.id, JSON.stringify({ template: t.id, version: t.version })],
  );
  return e.id;
}
