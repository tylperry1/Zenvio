import { deliverBookingEmails, sendAccountMail } from "@/lib/mail";
import { NextRequest } from "next/server";
import { stripeClient } from "@/lib/billing";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import {
  integrationFields,
  saveIntegration,
  pricing,
  type IntegrationKey,
} from "@/lib/platform-settings";
import {
  sameOrigin,
  body,
  failure,
  ApiError,
  string,
  uuid,
} from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await adminSession();
    const start = Date.now();
    await getPool().query("SELECT 1");
    const health = {
      database: { ok: true, latencyMs: Date.now() - start },
      encryption: { ok: Boolean(process.env.INTEGRATION_ENCRYPTION_KEY) },
    };
    const { rows: stored } = await getPool().query(
      "SELECT key,updated_at FROM private.integration_secrets",
    );
    const integrations = Object.entries(integrationFields).map(
      ([key, label]) => ({
        key,
        label,
        configured:
          stored.some((r) => r.key === key) || Boolean(process.env[key]),
        updatedAt: stored.find((r) => r.key === key)?.updated_at,
      }),
    );
    const { rows: subscriptions } = await getPool().query(
      'SELECT s.*,u.name,u.email FROM private.subscriptions s JOIN public."user" u ON u.id=s.user_id ORDER BY s.updated_at DESC LIMIT 100',
    );
    const { rows: activity } = await getPool().query(
      "SELECT action,details,created_at FROM private.operation_log ORDER BY created_at DESC LIMIT 50",
    );
    const { rows: emailDelivery } = await getPool().query(
      "SELECT count(*) FILTER(WHERE sent_at IS NULL)::int AS pending,count(*) FILTER(WHERE sent_at IS NOT NULL)::int AS sent,count(*) FILTER(WHERE sent_at IS NULL AND attempts>=5)::int AS failed FROM private.email_outbox",
    );
    const { rows: users } = await getPool().query(
      'SELECT id,name,email,"emailVerified","createdAt" FROM public."user" ORDER BY "createdAt" DESC LIMIT 100',
    );
    return Response.json(
      {
        health,
        integrations,
        pricing: await pricing(),
        subscriptions,
        activity,
        users,
        emailDelivery: emailDelivery[0],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token, user } = await adminSession();
    const input = await body(request);
    if (input.action === "test-email") {
      await sendAccountMail(
        user.email,
        "Your Zenvio email integration is connected",
        request.nextUrl.origin + "/admin/operations",
      );
    } else if (input.action === "retry-emails") {
      await deliverBookingEmails();
    } else if (input.action === "revoke-sessions") {
      const target = uuid(input.userId);
      if (target === token)
        throw new ApiError("Use Sign out to end your own session.");
      const reason = string(input.reason, "reason", 500, 5);
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query('DELETE FROM public.session WHERE "userId"=$1', [
          target,
        ]);
        await client.query(
          "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
          [
            token,
            "sessions_revoked",
            JSON.stringify({ userId: target, reason }),
          ],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } else if (
      input.action === "subscription-cancel" ||
      input.action === "subscription-resume"
    ) {
      const target = uuid(input.userId),
        reason = string(input.reason, "reason", 500, 5);
      const { rows } = await getPool().query(
        "SELECT subscription_id FROM private.subscriptions WHERE user_id=$1",
        [target],
      );
      if (!rows[0]?.subscription_id)
        throw new ApiError("This account has no subscription.", 404);
      const stripe = await stripeClient();
      await stripe.subscriptions.update(rows[0].subscription_id, {
        cancel_at_period_end: input.action === "subscription-cancel",
      });
      await getPool().query(
        "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
        [token, input.action, JSON.stringify({ userId: target, reason })],
      );
    } else if (input.action === "integration") {
      if (
        typeof input.key !== "string" ||
        !Object.hasOwn(integrationFields, input.key)
      )
        throw new ApiError("Unknown integration.");
      await saveIntegration(
        input.key as IntegrationKey,
        string(input.value, "value", 4096, 1),
        token,
      );
    } else if (input.action === "pricing") {
      if (!Array.isArray(input.plans) || input.plans.length !== 4)
        throw new ApiError("Supply all four plans.");
      const plans = input.plans.map((p: any, i: number) => {
        if (
          !p ||
          typeof p !== "object" ||
          p.id !== ["free", "pro", "business", "teams"][i] ||
          !Number.isInteger(p.monthly) ||
          !Number.isInteger(p.annual) ||
          p.monthly < 0 ||
          p.monthly > 1000000 ||
          p.annual < 0 ||
          p.annual > 12000000 ||
          (i === 0 && (p.monthly || p.annual))
        )
          throw new ApiError("Invalid pricing. Prices use USD cents.");
        return {
          id: p.id,
          name: ["Free", "Pro", "Business", "Teams"][i],
          monthly: p.monthly,
          annual: p.annual,
          seats: i === 3 ? 3 : 1,
        };
      });
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE private.platform_settings SET value=$1,updated_at=now() WHERE key='pricing'",
          [JSON.stringify(plans)],
        );
        await client.query(
          "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
          [token, "pricing_updated", JSON.stringify({ plans })],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } else throw new ApiError("Unknown action.");
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
