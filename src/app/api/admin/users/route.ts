import { NextRequest, after } from "next/server";
import { adminSession } from "@/lib/admin";
import { getAuth, mailConfigured } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { ApiError, body, email, failure, sameOrigin, string, uuid } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await adminSession();
    const input = await body(request), id = uuid(input.id);
    const reason = string(input.reason, "reason", 500, 5);
    if (input.action !== "edit" && input.action !== "delete") throw new ApiError("Invalid user action.");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const account = (await client.query('SELECT id,name,email FROM public."user" WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!account) throw new ApiError("User not found.", 404);
      const roles = await client.query("SELECT user_id FROM private.platform_roles WHERE user_id=$1 AND enabled=true", [id]);
      if (id === token || roles.rowCount || account.email.toLowerCase() === (process.env.MASTER_ADMIN_EMAIL || "").toLowerCase())
        throw new ApiError("Master admin accounts are protected. Use your own Settings to update your profile.", 409);
      if (input.action === "delete") {
        if (input.confirmation !== account.email) throw new ApiError("Type the user's email exactly to confirm deletion.");
        const orders = await client.query("SELECT 1 FROM private.marketplace_orders WHERE user_id=$1 LIMIT 1", [id]);
        if (orders.rowCount) throw new ApiError("This user has marketplace order history and cannot be permanently deleted. Keep the account to preserve its orders.", 409);
        const billing = await client.query("SELECT 1 FROM private.subscriptions WHERE user_id=$1 AND (customer_id IS NOT NULL OR subscription_id IS NOT NULL)", [id]);
        if (billing.rowCount) throw new ApiError("This user has billing records and cannot be permanently deleted. Manage the subscription in Billing first; billing history must be retained.", 409);
        const bookings = await client.query("SELECT 1 FROM public.bookings WHERE user_id=$1 AND status='confirmed' AND ends_at>now() LIMIT 1", [id]);
        if (bookings.rowCount) throw new ApiError("Cancel this user's upcoming appointments before deleting the account.", 409);
        const jobs = await client.query("SELECT 1 FROM private.google_calendar_jobs WHERE user_id=$1 LIMIT 1", [id]);
        if (jobs.rowCount) throw new ApiError("Finish this user's pending calendar sync before deleting the account.", 409);
        await client.query('DELETE FROM public."user" WHERE id=$1', [id]);
      } else {
        const name = string(input.name, "name", 100, 2), address = email(input.email);
        const timezone = string(input.timezone, "timezone", 100);
        try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw new ApiError("Choose a valid timezone."); }
        if (address !== account.email && address === (process.env.MASTER_ADMIN_EMAIL || "").toLowerCase()) throw new ApiError("That email is reserved.", 409);
        await client.query('UPDATE public."user" SET name=$2,email=$3,"emailVerified"=CASE WHEN email=$3 THEN "emailVerified" ELSE false END,"updatedAt"=now() WHERE id=$1', [id, name, address]);
        await client.query('UPDATE public.profiles SET name=$2,timezone=$3 WHERE id=$1', [id, name, timezone]);
        if (address !== account.email) {
          await client.query('DELETE FROM public.session WHERE "userId"=$1', [id]);
          await client.query('DELETE FROM public.verification WHERE identifier=$1', [account.email]);
        }
      }
      await client.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)", [token, input.action === "delete" ? "user_deleted" : "user_edited", JSON.stringify({ userId: id, reason, emailChanged: input.action === "edit" && input.email !== account.email })]);
      await client.query("COMMIT");
      if (input.action === "edit" && email(input.email) !== account.email && mailConfigured()) {
        const address = email(input.email);
        after(async () => {
          try { await getAuth().api.sendVerificationEmail({ body: { email: address, callbackURL: "/app" } }); }
          catch { console.error("Unable to deliver updated user verification email"); }
        });
      }
      return Response.json({ ok: true, message: input.action === "delete" ? "User deleted successfully." : "User updated successfully." }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      await client.query("ROLLBACK");
      if ((e as { code?: string }).code === "23505") throw new ApiError("That email is already in use.", 409);
      throw e;
    } finally { client.release(); }
  } catch (error) { return failure(error); }
}
