import type { PoolClient } from "pg";
import { queueDelivery, appOrigin } from "./lifecycle";
import { sealSecret, unsealSecret } from "./platform-settings";
import { ApiError } from "./server";
export async function queueEnvelopeInvitation(
  db: PoolClient,
  envelope: any,
  recipient: any,
  secret: string,
  series = "initial",
) {
  await db.query(
    "UPDATE private.signature_recipients SET link_ciphertext=$2 WHERE id=$1",
    [recipient.id, sealSecret(secret)],
  );
  const text = `${recipient.name},\n\nPlease review and sign: ${envelope.title}\n${envelope.message || ""}\n\n${appOrigin()}/sign/envelope#token=${secret}\n\nThis private link is for you only. Do not forward it.`;
  for (const days of [0, ...(envelope.reminder_days || [3, 7])])
    await queueDelivery(db, {
      user: envelope.user_id,
      kind: days ? "document_reminder" : "document_invitation",
      key: `envelope:${envelope.id}:${recipient.id}:${series}:${days}`,
      envelope: envelope.id,
      recipient: recipient.id,
      to: recipient.email,
      subject: (days ? "Reminder: " : "Please sign: ") + envelope.title,
      text,
      at: new Date(Date.now() + days * 86400000),
      expires: new Date(envelope.expires_at || Date.now() + 14 * 86400000),
    });
}
export async function resendEnvelope(db: PoolClient, e: any, r: any) {
  if (!r.link_ciphertext)
    throw new ApiError(
      "This older document has no retained delivery link. Share your original link or create a new document.",
      409,
    );
  if (
    e.status !== "sent" ||
    r.status === "signed" ||
    new Date(e.expires_at).getTime() < Date.now()
  )
    throw new ApiError(
      "Only an active unsigned invitation can be resent.",
      409,
    );
  const recent = await db.query(
    "SELECT 1 FROM private.delivery_jobs WHERE recipient_id=$1 AND kind='document_invitation' AND created_at>now()-interval '5 minutes'",
    [r.id],
  );
  if (recent.rowCount)
    throw new ApiError("Please wait five minutes before resending.", 429);
  await queueEnvelopeInvitation(
    db,
    e,
    r,
    unsealSecret(r.link_ciphertext),
    String(Date.now()),
  );
}
export async function queueEnvelopeCompletion(db: PoolClient, e: any) {
  const recipients = (
      await db.query(
        "SELECT * FROM private.signature_recipients WHERE envelope_id=$1",
        [e.id],
      )
    ).rows,
    owner = (
      await db.query('SELECT email FROM public."user" WHERE id=$1', [e.user_id])
    ).rows[0];
  if (owner)
    await queueDelivery(db, {
      user: e.user_id,
      kind: "document_complete",
      key: `complete:${e.id}:owner`,
      envelope: e.id,
      to: owner.email,
      subject: "Completed: " + e.title,
      text: `Everyone has signed ${e.title}. Download the completed PDF from ${appOrigin()}/app/documents.`,
    });
  for (const r of recipients)
    if (r.link_ciphertext)
      await queueDelivery(db, {
        user: e.user_id,
        kind: "document_complete",
        key: `complete:${e.id}:${r.id}`,
        envelope: e.id,
        recipient: r.id,
        to: r.email,
        subject: "Completed: " + e.title,
        text: `Everyone has signed ${e.title}. Open your private link to download the completed PDF:\n${appOrigin()}/sign/envelope#token=${unsealSecret(r.link_ciphertext)}`,
      });
  await db.query(
    "UPDATE private.delivery_jobs SET status='cancelled',payload_ciphertext=NULL WHERE envelope_id=$1 AND kind IN ('document_reminder','document_invitation') AND status='queued'",
    [e.id],
  );
}
