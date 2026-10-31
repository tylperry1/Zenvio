import { individualOffer, teamOffer, extraSeatOffer } from "@/lib/subscription-offers.mjs";
import {
  ResendDeliveryError,
  emailDiagnostics,
} from "@/lib/resend-diagnostics";
import { deliverBookingEmails, sendAccountMail } from "@/lib/mail";
import { NextRequest } from "next/server";
import { changeSubscription } from "@/lib/subscription-management";
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
      "SELECT (SELECT count(*)::int FROM private.delivery_jobs WHERE status='queued')+(SELECT count(*)::int FROM private.email_outbox WHERE sent_at IS NULL AND migrated_at IS NULL AND attempts<5) pending,(SELECT count(*)::int FROM private.delivery_jobs WHERE status='sent')+(SELECT count(*)::int FROM private.email_outbox WHERE sent_at IS NOT NULL) sent,(SELECT count(*)::int FROM private.delivery_jobs WHERE status IN ('failed','uncertain'))+(SELECT count(*)::int FROM private.email_outbox WHERE sent_at IS NULL AND migrated_at IS NULL AND attempts>=5) failed",
    );
    const { rows: users } = await getPool().query(
      'SELECT id,name,email,"emailVerified","createdAt" FROM public."user" ORDER BY "createdAt" DESC LIMIT 100',
    );
    const { rows: migrations } = await getPool().query(
      "SELECT name,applied_at FROM private.schema_migrations ORDER BY name DESC",
    );
    const { rows: queue } = await getPool().query(
      "SELECT (SELECT min(created_at) FROM (SELECT created_at FROM private.delivery_jobs WHERE status='queued' UNION ALL SELECT created_at FROM private.email_outbox WHERE sent_at IS NULL AND migrated_at IS NULL) q) oldest_pending,(SELECT max(sent_at) FROM(SELECT sent_at FROM private.delivery_jobs UNION ALL SELECT sent_at FROM private.email_outbox) s) last_sent",
    );
    return Response.json(
      {
        health,
        emailDiagnostics: await emailDiagnostics(),
        healthDetails: {
          checkedAt: new Date().toISOString(),
          nodeVersion: process.version,
          environment: process.env.VERCEL_ENV || "development",
          migrationCount: migrations.length,
          lastMigration: migrations[0]?.name || null,
          lastMigrationAt: migrations[0]?.applied_at || null,
          oldestPendingEmail: queue[0]?.oldest_pending,
          lastEmailSent: queue[0]?.last_sent,
        },
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
      await changeSubscription(
        target,
        input.action === "subscription-cancel",
        token,
        reason,
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
      if (!Array.isArray(input.plans) || ![4,7].includes(input.plans.length))
        throw new ApiError("Supply all four legacy plans and, optionally, the three approved package rates.");
      if (input.plans.length === 7) {
        for (const offer of [individualOffer,teamOffer,extraSeatOffer]) {
          const matches = input.plans.filter((p: any) => p?.id === offer.id);
          if (matches.length !== 1 || matches[0].monthly !== offer.monthly || matches[0].annual !== offer.annual || matches[0].seats !== offer.seats)
            throw new ApiError("Approved Individual and Teams package rates cannot be changed through legacy pricing controls.",409);
        }
      }
      const legacy = input.plans.filter((p: any) => ["free","pro","business","teams"].includes(p?.id));
      if (legacy.length !== 4) throw new ApiError("Supply all four legacy plans.");
      const plans = legacy.map((p: any, i: number) => {
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
    if (e instanceof ResendDeliveryError)
      return failure(new ApiError(e.message, e.retryable ? 503 : 400));
    return failure(e);
  }
}

