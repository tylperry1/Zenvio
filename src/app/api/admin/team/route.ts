import { NextRequest, after } from "next/server";
import { adminSession, isStaffPermission, staffPermissions } from "@/lib/admin";
import { getAuth } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { mailReady } from "@/lib/mail";
import { ApiError, body, email, failure, sameOrigin, string, uuid } from "@/lib/server";

export const dynamic = "force-dynamic";
const plans = ["team", "individual", "business", "pro"] as const;

function permissionsFrom(value: unknown) {
  if (!Array.isArray(value) || value.length > 50)
    throw new ApiError("Choose the areas this employee can manage.");
  return [...new Set(value.filter(isStaffPermission))];
}
function planFrom(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (!plans.includes(value as (typeof plans)[number]))
    throw new ApiError("Choose a valid workspace plan.");
  return value as string;
}
function titleFrom(value: unknown) {
  return string(value ?? "", "title", 80, 0).trim();
}

async function sendSetupEmail(address: string, origin: string) {
  if (!(await mailReady())) return false;
  // No request headers: this must never create or change the admin's own session.
  after(async () => {
    try {
      await getAuth().api.requestPasswordReset({
        body: { email: address, redirectTo: `${origin}/reset-password` },
      });
    } catch {
      console.error("Unable to deliver employee setup email");
    }
  });
  return true;
}

export async function GET() {
  try {
    await adminSession();
    const { rows } = await getPool().query(
      `SELECT s.user_id id,u.name,u.email,u."emailVerified" verified,s.title,s.permissions,s.workspace_plan,
              s.enabled,s.created_at,s.updated_at,inviter.email invited_by,
              (SELECT max(x."createdAt") FROM public.session x WHERE x."userId"=u.id) last_sign_in,
              EXISTS(SELECT 1 FROM public.account a WHERE a."userId"=u.id AND a."providerId"='credential') has_password
         FROM private.staff_members s
         JOIN public."user" u ON u.id=s.user_id
         LEFT JOIN public."user" inviter ON inviter.id=s.invited_by
        ORDER BY s.enabled DESC,u.name`,
    );
    const owner = await getPool().query(
      `SELECT u.name,u.email FROM private.platform_roles r JOIN public."user" u ON u.id=r.user_id WHERE r.enabled ORDER BY r.created_at LIMIT 1`,
    );
    return Response.json(
      {
        owner: owner.rows[0] || null,
        staff: rows,
        permissions: staffPermissions,
        mail: await mailReady(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    // Managing employees is reserved to the master admin and never delegated.
    const { token } = await adminSession();
    const input = await body(request);
    const origin = request.nextUrl.origin;
    const client = await getPool().connect();
    let message = "Saved.";
    try {
      await client.query("BEGIN");
      const audit = (account: string, action: string, details: unknown) =>
        client.query(
          "INSERT INTO private.admin_audit_log(actor_id,account_id,action,details) VALUES($1,$2,$3,$4)",
          [token, account, action, JSON.stringify(details)],
        );

      if (input.action === "invite") {
        const address = email(input.email),
          name = string(input.name, "name", 100, 2),
          title = titleFrom(input.title),
          permissions = permissionsFrom(input.permissions),
          plan = planFrom(input.workspacePlan);
        let user = (
          await client.query('SELECT id FROM public."user" WHERE lower(email)=$1 FOR UPDATE', [address])
        ).rows[0];
        if (user) {
          const owner = await client.query(
            "SELECT 1 FROM private.platform_roles WHERE user_id=$1",
            [user.id],
          );
          if (owner.rowCount) throw new ApiError("That is the master admin account.", 409);
          const existing = await client.query(
            "SELECT 1 FROM private.staff_members WHERE user_id=$1",
            [user.id],
          );
          if (existing.rowCount) throw new ApiError("This person is already on the Zenvio team.", 409);
        } else {
          if (address === (process.env.MASTER_ADMIN_EMAIL || "").trim().toLowerCase())
            throw new ApiError("That email is reserved.", 409);
          // The master admin vouches for the address; the employee proves
          // ownership by choosing a password from the emailed link.
          user = (
            await client.query(
              'INSERT INTO public."user"(name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,true,now(),now()) RETURNING id',
              [name, address],
            )
          ).rows[0];
        }
        await client.query(
          "INSERT INTO private.staff_members(user_id,title,permissions,workspace_plan,invited_by) VALUES($1,$2,$3,$4,$5)",
          [user.id, title, permissions, plan, token],
        );
        await audit(user.id, "staff_added", { email: address, title, permissions, workspacePlan: plan });
        await client.query("COMMIT");
        const hasPassword = await getPool().query(
          `SELECT 1 FROM public.account WHERE "userId"=$1 AND "providerId"='credential'`,
          [user.id],
        );
        if (hasPassword.rowCount) message = `${name} now has Zenvio team access with their existing sign-in.`;
        else
          message = (await sendSetupEmail(address, origin))
            ? `Invitation sent. ${name} will receive an email to set their password.`
            : `Account created. Email isn't connected yet, so ask ${name} to use "Forgot password" once it is.`;
        return Response.json({ ok: true, message, id: user.id }, { headers: { "Cache-Control": "no-store" } });
      }

      const id = uuid(input.id);
      const member = (
        await client.query(
          'SELECT s.*,u.email,u.name FROM private.staff_members s JOIN public."user" u ON u.id=s.user_id WHERE s.user_id=$1 FOR UPDATE OF s',
          [id],
        )
      ).rows[0];
      if (!member) throw new ApiError("Team member not found.", 404);

      if (input.action === "update") {
        const next = {
          title: input.title === undefined ? member.title : titleFrom(input.title),
          permissions: input.permissions === undefined ? member.permissions : permissionsFrom(input.permissions),
          plan: input.workspacePlan === undefined ? member.workspace_plan : planFrom(input.workspacePlan),
          enabled: typeof input.enabled === "boolean" ? input.enabled : member.enabled,
        };
        await client.query(
          "UPDATE private.staff_members SET title=$2,permissions=$3,workspace_plan=$4,enabled=$5,updated_at=now() WHERE user_id=$1",
          [id, next.title, next.permissions, next.plan, next.enabled],
        );
        await audit(id, next.enabled === member.enabled ? "staff_updated" : next.enabled ? "staff_enabled" : "staff_suspended", {
          email: member.email,
          before: { title: member.title, permissions: member.permissions, workspacePlan: member.workspace_plan, enabled: member.enabled },
          after: { title: next.title, permissions: next.permissions, workspacePlan: next.plan, enabled: next.enabled },
        });
        message = next.enabled === member.enabled ? "Access updated." : next.enabled ? "Access restored." : "Access suspended.";
      } else if (input.action === "remove") {
        await client.query("DELETE FROM private.staff_members WHERE user_id=$1", [id]);
        await audit(id, "staff_removed", { email: member.email, title: member.title });
        message = `${member.name} was removed from the Zenvio team. Their personal account remains.`;
      } else if (input.action === "resend") {
        await audit(id, "staff_invite_resent", { email: member.email });
        await client.query("COMMIT");
        message = (await sendSetupEmail(member.email, origin))
          ? "Setup email sent."
          : "Email isn't connected yet. Connect Resend under Connections first.";
        return Response.json({ ok: true, message }, { headers: { "Cache-Control": "no-store" } });
      } else throw new ApiError("Unknown action.");

      await client.query("COMMIT");
      return Response.json({ ok: true, message }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if ((error as { code?: string }).code === "23505")
        throw new ApiError("That email is already in use.", 409);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return failure(error);
  }
}
