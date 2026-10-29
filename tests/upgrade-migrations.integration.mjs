// Disposable real-Postgres compatibility fixture. No application/provider credentials.
import { Pool } from "pg";
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const input = process.env.TEST_DATABASE_URL;
if (
  process.env.TEST_REAL_POSTGRES !== "true" ||
  !input ||
  !["localhost", "127.0.0.1"].includes(new URL(input).hostname)
)
  throw Error("Explicit disposable localhost Postgres required");
const name = "zenvio_compat_" + randomUUID().replaceAll("-", ""),
  control = new Pool({ connectionString: input });
let db;
try {
  await control.query("CREATE DATABASE " + name);
  const url = new URL(input);
  url.pathname = "/" + name;
  db = new Pool({ connectionString: url.toString(), max: 1 });
  const files = fs
    .readdirSync("postgres/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const apply = async (files) => {
    for (const f of files)
      await db.query(
        fs
          .readFileSync("postgres/migrations/" + f, "utf8")
          .replace(/^begin;\s*$/gim, "")
          .replace(/^commit;\s*$/gim, ""),
      );
  };
  await apply(files.filter((f) => Number(f.slice(0, 3)) <= 16));
  const user = randomUUID();
  await db.query('INSERT INTO public."user"(id,name,email) VALUES($1,$2,$3)', [
    user,
    "Existing fixture",
    "existing@example.com",
  ]);
  await db.query("UPDATE public.profiles SET name=$2,slug=$3 WHERE id=$1", [
    user,
    "Existing fixture",
    "existing-fixture",
  ]);
  const types = (
    await db.query("SELECT id FROM public.event_types WHERE user_id=$1", [user])
  ).rows.map((r) => r.id);
  for (let n = types.length; n < 3; n++)
    types.push(
      (
        await db.query(
          "INSERT INTO public.event_types(user_id,title,slug) VALUES($1,$2,$3) RETURNING id",
          [user, "Existing type " + n, "existing-" + n],
        )
      ).rows[0].id,
    );
  const contact = (
    await db.query(
      "INSERT INTO public.contacts(user_id,name,email,notes) VALUES($1,$2,$3,$4) RETURNING id",
      [user, "Existing guest", "existing-guest@example.com", "Preserve notes"],
    )
  ).rows[0].id;
  const booking = (
    await db.query(
      "INSERT INTO public.bookings(user_id,event_id,guest_name,guest_email,starts_at,ends_at,blocked_until) VALUES($1,$2,'Existing guest','existing-guest@example.com',now()+interval '10 days',now()+interval '10 days 30 minutes',now()+interval '10 days 45 minutes') RETURNING id,cancel_token",
      [user, types[0]],
    )
  ).rows[0];
  const signed = (
    await db.query(
      "INSERT INTO private.signing_documents(user_id,title,content,recipient_name,recipient_email,content_hash,token_hash,status,signed_at,signature_name,receipt_hash) VALUES($1,'Existing signed record','Original immutable content','Existing guest','existing-guest@example.com','original-content-hash','original-token-hash','signed',now(),'Original signature','original-receipt') RETURNING id",
      [user],
    )
  ).rows[0];
  await db.query(
    "INSERT INTO private.subscriptions(user_id,customer_id,subscription_id,plan,status) VALUES($1,'cus_fixture_existing','sub_fixture_existing','free','inactive')",
    [user],
  );
  await apply(files.filter((f) => Number(f.slice(0, 3)) > 16));
  const retained = (
    await db.query(
      "SELECT id,cancel_token,contact_id,revision FROM public.bookings WHERE id=$1",
      [booking.id],
    )
  ).rows[0];
  assert.equal(retained.id, booking.id);
  assert.equal(retained.cancel_token, booking.cancel_token);
  assert.equal(retained.contact_id, contact);
  assert.equal(retained.revision, 0);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM public.event_types WHERE user_id=$1 AND active",
        [user],
      )
    ).rows[0].n,
    3,
  );
  await assert.rejects(
    db.query(
      "INSERT INTO public.event_types(user_id,title,slug) VALUES($1,'Over-limit new type','over-limit-new')",
      [user],
    ),
    /invalid_active_type_limit/,
  );
  const record = (
    await db.query(
      "SELECT content,signature_name,receipt_hash FROM private.signing_documents WHERE id=$1",
      [signed.id],
    )
  ).rows[0];
  assert.equal(record.content, "Original immutable content");
  assert.equal(record.signature_name, "Original signature");
  assert.equal(record.receipt_hash, "original-receipt");
  assert.equal(
    (
      await db.query(
        "SELECT subscription_id FROM private.subscriptions WHERE user_id=$1",
        [user],
      )
    ).rows[0].subscription_id,
    "sub_fixture_existing",
  );
  assert.equal(
    (await db.query("SELECT notes FROM public.contacts WHERE id=$1", [contact]))
      .rows[0].notes,
    "Preserve notes",
  );
  await db.query(
    "UPDATE private.email_outbox SET migrated_at=now() WHERE booking_id=$1",
    [booking.id],
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM private.email_outbox WHERE booking_id=$1 AND sent_at IS NULL AND attempts<5",
        [booking.id],
      )
    ).rows[0].n,
    0,
    "Old application delivery query must not resend bridged mail",
  );
  console.log(
    "PASS migration compatibility: pre-upgrade appointments/tokens/contact links, signed content/receipts, subscriptions, notes and over-limit types preserved.",
  );
} finally {
  if (db) await db.end();
  await control.query("DROP DATABASE IF EXISTS " + name);
  await control.end();
}
