import { getPool } from "../db";
import { untrusted, type ToolContext } from "./tools";

export async function assistantContext(user: { id: string; name?: string | null; email?: string | null }): Promise<ToolContext> {
  const p = (await getPool().query("SELECT name,timezone FROM public.profiles WHERE id=$1", [user.id])).rows[0];
  return { userId: user.id, userName: p?.name || user.name || "there", timezone: p?.timezone || "UTC" };
}

// Page context ("viewing this client") is resolved on the server against the user's own records,
// so the model only learns about records the user can open.
export async function pageContext(userId: string, value: unknown) {
  if (!value || typeof value !== "object") return "";
  const { type, id } = value as { type?: unknown; id?: unknown };
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) return "";
  const pool = getPool();
  if (type === "client") {
    const c = (await pool.query("SELECT name FROM public.contacts WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
    return c ? `[Page context: the user is viewing the client ${untrusted(c.name, 100)} (client_id ${id}).]` : "";
  }
  if (type === "appointment") {
    const b = (
      await pool.query(
        "SELECT b.guest_name,e.title FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id WHERE b.id=$1 AND b.user_id=$2",
        [id, userId],
      )
    ).rows[0];
    return b ? `[Page context: the user is viewing the appointment ${untrusted(b.title + " with " + b.guest_name, 160)} (appointment_id ${id}).]` : "";
  }
  if (type === "job") {
    const j = (await pool.query("SELECT title FROM private.jobs WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
    return j ? `[Page context: the user is viewing the job ${untrusted(j.title, 120)} (job_id ${id}).]` : "";
  }
  if (type === "document") {
    const d = (await pool.query("SELECT title FROM private.signature_envelopes WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
    return d ? `[Page context: the user is viewing the document ${untrusted(d.title, 120)} (document_id ${id}).]` : "";
  }
  return "";
}
