import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { emailDiagnostics } from "@/lib/resend-diagnostics";
import { twilioConfigured, normalizeE164 } from "@/lib/twilio";
import { ApiError, body, failure, sameOrigin, string } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await adminSession();
    const [calendar, email, sms, webhooks, settings] = await Promise.all([
      getPool().query(
        `select status,count(*)::int count,max(last_sync_at) last_success,
                count(*) filter(where last_error is not null)::int degraded
           from private.google_calendar_connections group by status`,
      ),
      getPool().query(
        `select provider_status,count(*)::int count,max(sent_at) last_sent
           from private.delivery_jobs group by provider_status`,
      ),
      getPool().query(
        `select registration_state,messaging_enabled,count(*)::int count
           from private.sms_provider_connections
          group by registration_state,messaging_enabled`,
      ),
      getPool().query(
        `select provider,count(*) filter(where processed_at is null)::int pending,
                count(*) filter(where last_error is not null)::int failed,
                max(processed_at) last_processed
           from private.provider_webhook_events group by provider`,
      ),
      getPool().query(
        "select value from private.platform_settings where key='integration_features'",
      ),
    ]);
    const failedJobs = await getPool().query(
      `select id,kind,status,attempts,provider_status,last_error,created_at
         from private.delivery_jobs where status in ('failed','uncertain')
        order by created_at desc limit 100`,
    );
    return Response.json(
      {
        checkedAt: new Date().toISOString(),
        providers: {
          googleCalendar: calendar.rows,
          resend: {
            diagnostics: await emailDiagnostics(),
            delivery: email.rows,
          },
          twilio: { configured: await twilioConfigured(), connections: sms.rows },
          webhooks: webhooks.rows,
        },
        featureFlags: settings.rows[0]?.value || {},
        failedJobs: failedJobs.rows,
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
    const { token } = await adminSession();
    const input = await body(request);
    const reason = string(input.reason, "reason", 500, 8);
    const client = await getPool().connect();
    try {
      await client.query("begin");
      if (input.action === "retry-email") {
        if (input.confirmation !== "RETRY_FAILED_EMAILS")
          throw new ApiError("Type the required confirmation before retrying deliveries.");
        await client.query(
          `update private.delivery_jobs set status='queued',run_at=now(),last_error=null
            where status='failed' and provider_id is null and attempts<5`,
        );
      } else if (input.action === "retry-calendar") {
        if (input.confirmation !== "RETRY_CALENDAR_SYNC")
          throw new ApiError("Type the required confirmation before retrying calendar synchronization.");
        await client.query(
          `update private.google_calendar_jobs set attempts=0,not_before=now(),last_error=null,
                  locked_until=null,claim_token=null
            where attempts>=8 and exists(
              select 1 from private.google_calendar_connections c
              where c.user_id=private.google_calendar_jobs.user_id and c.status='connected'
            )`,
        );
      } else if (input.action === "sms-connection") {
        const userId = string(input.userId, "account", 64);
        const sender = normalizeE164(string(input.senderNumber, "sender number", 20));
        const state = string(input.registrationState, "registration state", 20);
        if (!["unregistered", "pending", "approved", "rejected", "not_required"].includes(state))
          throw new ApiError("Invalid registration state.");
        const country = string(input.countryCode, "country", 2).toUpperCase();
        if (!/^[A-Z]{2}$/.test(country)) throw new ApiError("Invalid country code.");
        if (typeof input.enabled !== "boolean") throw new ApiError("Invalid SMS activation state.");
        if (input.enabled && country === "US" && !["approved", "not_required"].includes(state))
          throw new ApiError("US SMS cannot be enabled before registration approval.", 409);
        await client.query(
          `insert into private.sms_provider_connections
            (user_id,sender_number,registration_state,messaging_enabled,country_code)
           values($1,$2,$3,$4,$5)
           on conflict(user_id) do update set sender_number=$2,registration_state=$3,
             messaging_enabled=$4,country_code=$5,updated_at=now()`,
          [userId, sender, state, input.enabled, country],
        );
      } else if (input.action === "feature-flag") {
        const flag = string(input.flag, "feature flag", 60);
        if (!["sms", "microsoft_calendar", "supplier_sync", "ai_actions"].includes(flag))
          throw new ApiError("Unknown feature flag.");
        if (typeof input.enabled !== "boolean") throw new ApiError("Invalid feature flag state.");
        await client.query(
          `insert into private.platform_settings(key,value) values('integration_features',$1)
           on conflict(key) do update set value=coalesce(private.platform_settings.value,'{}'::jsonb)||$1::jsonb,updated_at=now()`,
          [JSON.stringify({ [flag]: input.enabled })],
        );
      } else throw new ApiError("Unknown provider operation.");
      await client.query(
        "insert into private.operation_log(actor_id,action,details) values($1,$2,$3)",
        [token, `provider_${input.action}`, JSON.stringify({ reason })],
      );
      await client.query("commit");
      return Response.json({ ok: true });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return failure(error);
  }
}
