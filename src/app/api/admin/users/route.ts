import { NextRequest, after } from "next/server";
import { adminSession } from "@/lib/admin";
import { getAuth, mailConfigured } from "@/lib/auth";
import { getPool } from "@/lib/db";
import {
  ApiError,
  body,
  email,
  failure,
  sameOrigin,
  string,
  uuid,
} from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request:NextRequest){try{await adminSession("accounts");const id=uuid(request.nextUrl.searchParams.get("id"));const account=(await getPool().query('SELECT deactivated_at FROM public."user" WHERE id=$1',[id])).rows[0];if(!account)throw new ApiError("User not found.",404);return Response.json(account,{headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e);}}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token, access } = await adminSession("accounts");
    const input = await body(request),
      id = uuid(input.id);
    const reason = string(input.reason, "reason", 500, 5);
    if (!["edit","delete","deactivate","reactivate"].includes(String(input.action)))
      throw new ApiError("Invalid user action.");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const account = (
        await client.query(
          'SELECT id,name,email FROM public."user" WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (!account) throw new ApiError("User not found.", 404);
      const roles = await client.query(
        "SELECT user_id FROM private.platform_roles WHERE user_id=$1",
        [id],
      );
      if (
        id === token ||
        roles.rowCount ||
        account.email.toLowerCase() ===
          (process.env.MASTER_ADMIN_EMAIL || "").toLowerCase()
      )
        throw new ApiError(
          "Master admin accounts are protected. Use your own Settings to update your profile.",
          409,
        );
      const staff = await client.query(
        "SELECT user_id FROM private.staff_members WHERE user_id=$1",
        [id],
      );
      if (staff.rowCount && access.role !== "master_admin")
        throw new ApiError(
          "Zenvio employee accounts can only be changed by the master admin.",
          409,
        );
      if(input.action==="deactivate"||input.action==="reactivate"){
        await client.query('UPDATE public."user" SET deactivated_at=CASE WHEN $2 THEN now() ELSE NULL END,"updatedAt"=now() WHERE id=$1',[id,input.action==="deactivate"]);
        await client.query('DELETE FROM public.session WHERE "userId"=$1',[id]);
      } else if (input.action === "delete") {
        if (input.confirmation !== account.email)
          throw new ApiError(
            "Type the user's email exactly to confirm deletion.",
          );
        const retained = await client.query(
          "SELECT 1 FROM private.organizations WHERE owner_id=$1 UNION ALL SELECT 1 FROM private.appointment_payments WHERE user_id=$1 UNION ALL SELECT 1 FROM private.marketplace_artwork WHERE user_id=$1 LIMIT 1",
          [id],
        );
        if (retained.rowCount)
          throw new ApiError(
            "This account has organization, payment, or artwork history that must be retained. Permanent deletion is blocked.",
            409,
          );
        const orders = await client.query(
          "SELECT 1 FROM private.marketplace_orders WHERE user_id=$1 LIMIT 1",
          [id],
        );
        if (orders.rowCount)
          throw new ApiError(
            "This user has marketplace order history and cannot be permanently deleted. Keep the account to preserve its orders.",
            409,
          );
        const documents = await client.query(
          "SELECT 1 FROM private.signing_documents WHERE user_id=$1 UNION ALL SELECT 1 FROM private.signature_envelopes WHERE user_id=$1 LIMIT 1",
          [id],
        );
        if (documents.rowCount)
          throw new ApiError(
            "This user has document signing records and cannot be permanently deleted. Keep the account to preserve its agreements.",
            409,
          );
        const billing = await client.query(
          "SELECT 1 FROM private.subscriptions WHERE user_id=$1 AND (customer_id IS NOT NULL OR subscription_id IS NOT NULL)",
          [id],
        );
        if (billing.rowCount)
          throw new ApiError(
            "This user has billing records and cannot be permanently deleted. Manage the subscription in Billing first; billing history must be retained.",
            409,
          );
        const bookings = await client.query(
          "SELECT 1 FROM public.bookings WHERE user_id=$1 AND status='confirmed' AND ends_at>now() LIMIT 1",
          [id],
        );
        if (bookings.rowCount)
          throw new ApiError(
            "Cancel this user's upcoming appointments before deleting the account.",
            409,
          );
        const jobs = await client.query(
          "SELECT 1 FROM private.google_calendar_jobs WHERE user_id=$1 LIMIT 1",
          [id],
        );
        if (jobs.rowCount)
          throw new ApiError(
            "Finish this user's pending calendar sync before deleting the account.",
            409,
          );
        for(const table of ["private.client_activity","private.google_calendar_cleanup","private.entitlement_overrides","private.team_event_staff","private.memberships"])await client.query(`DELETE FROM ${table} WHERE user_id=$1`,[id]);
        await client.query('DELETE FROM public."user" WHERE id=$1', [id]);
      } else {
        const name = string(input.name, "name", 100, 2),
          address = email(input.email);
        const timezone = string(input.timezone, "timezone", 100);
        try {
          new Intl.DateTimeFormat("en", { timeZone: timezone });
        } catch {
          throw new ApiError("Choose a valid timezone.");
        }
        if (
          address !== account.email &&
          address === (process.env.MASTER_ADMIN_EMAIL || "").toLowerCase()
        )
          throw new ApiError("That email is reserved.", 409);
        await client.query(
          'UPDATE public."user" SET name=$2,email=$3,"emailVerified"=CASE WHEN email=$3 THEN "emailVerified" ELSE false END,"updatedAt"=now() WHERE id=$1',
          [id, name, address],
        );
        await client.query(
          "UPDATE public.profiles SET name=$2,timezone=$3 WHERE id=$1",
          [id, name, timezone],
        );
        if (address !== account.email) {
          await client.query('DELETE FROM public.session WHERE "userId"=$1', [
            id,
          ]);
          await client.query(
            "DELETE FROM public.verification WHERE identifier=$1",
            [account.email],
          );
        }
      }
      await client.query(
        "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
        [
          token,
          "user_"+String(input.action),
          JSON.stringify({
            userId: id,
            reason,
            emailChanged:
              input.action === "edit" && input.email !== account.email,
          }),
        ],
      );
      await client.query("COMMIT");
      if (
        input.action === "edit" &&
        email(input.email) !== account.email &&
        mailConfigured()
      ) {
        const address = email(input.email);
        after(async () => {
          try {
            await getAuth().api.sendVerificationEmail({
              body: { email: address, callbackURL: "/app" },
            });
          } catch {
            console.error("Unable to deliver updated user verification email");
          }
        });
      }
      return Response.json(
        {
          ok: true,
          message:
            input.action === "delete"
              ? "User deleted successfully."
              : input.action==="deactivate"?"Account deactivated and sessions revoked. Billing and legal records are retained.":input.action==="reactivate"?"Account reactivated. The user can sign in again.":"User updated successfully.",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (e) {
      await client.query("ROLLBACK");
      if ((e as {code?:string}).code === "23503") throw new ApiError("This account has records that must be retained. Deactivate the account instead; billing and legal records will be preserved.",409);
      if ((e as { code?: string }).code === "23505")
        throw new ApiError("That email is already in use.", 409);
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    return failure(error);
  }
}
