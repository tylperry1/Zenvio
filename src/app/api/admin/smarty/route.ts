import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { environment } from "@/lib/launch/provider-policy";
import {
  saveSmartyConfiguration,
  smartyConfiguration,
  smartyCredentials,
  smartyUsageSummary,
  testSmartyConnection,
} from "@/lib/smarty";
import { ApiError, body, failure, integer, sameOrigin } from "@/lib/server";

export const dynamic = "force-dynamic";
const noStore = { headers: { "Cache-Control": "no-store" } };

async function dashboard() {
  const [config, creds, usage, errors] = await Promise.all([
    smartyConfiguration(),
    smartyCredentials(),
    smartyUsageSummary(),
    getPool().query(
      "SELECT id,operation,status_code,category,message,created_at FROM private.smarty_api_errors ORDER BY created_at DESC LIMIT 25",
    ),
  ]);
  return {
    environment: environment(),
    config,
    credentials: {
      authIdConfigured: Boolean(creds.authId),
      authTokenConfigured: Boolean(creds.authToken),
      embeddedKeyConfigured: Boolean(creds.embeddedKey),
      configured: creds.configured,
    },
    usage: {
      ...usage,
      estimatedCostUsd: Number((usage.monthMicros / 1_000_000).toFixed(4)),
    },
    errors: errors.rows,
    endpoints: {
      autocomplete: "https://us-autocomplete-pro.api.smarty.com/lookup",
      validation: "https://us-street.api.smarty.com/street-address",
      docs: "https://www.smarty.com/docs/cloud/us-autocomplete-pro-api",
    },
  };
}

export async function GET() {
  try {
    await adminSession("integrations");
    return Response.json(await dashboard(), noStore);
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await adminSession("integrations");
    const input = await body(request);
    const action = String(input.action || "");
    if (action === "test") {
      const result = await testSmartyConnection();
      return Response.json({ ...result, dashboard: await dashboard() }, noStore);
    }
    if (action === "save") {
      // Credentials stay in the vault. Enabling only flips platform_settings — never invents keys.
      const config = await saveSmartyConfiguration(
        {
          enabled: input.enabled === true,
          environment: input.environment === "live" ? "live" : "test",
          autocompleteMicrosPerLookup: integer(
            input.autocompleteMicrosPerLookup ?? 2000,
            "autocomplete cost",
            0,
            1_000_000,
          ),
          validationMicrosPerLookup: integer(
            input.validationMicrosPerLookup ?? 2000,
            "validation cost",
            0,
            1_000_000,
          ),
          monthlyCapMicros: integer(
            input.monthlyCapMicros ?? 50_000_000,
            "monthly cap",
            0,
            1_000_000_000_000,
          ),
        },
        token,
      );
      return Response.json({ ok: true, config, dashboard: await dashboard() }, noStore);
    }
    throw new ApiError("Invalid action.");
  } catch (e) {
    return failure(e);
  }
}
