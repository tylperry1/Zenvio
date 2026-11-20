import { getPool } from "../db";
import { environment } from "../launch/provider-policy";
import { ApiError } from "../server";
import { integrationValue } from "../platform-settings";

export type SmartyConfig = {
  enabled: boolean;
  environment: "test" | "live";
  autocompleteMicrosPerLookup: number;
  validationMicrosPerLookup: number;
  monthlyCapMicros: number;
  lastSuccessfulAt: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  health: "unconfigured" | "disabled" | "healthy" | "degraded" | "action_required";
};

export const defaultSmartyConfig = (): SmartyConfig => ({
  enabled: false,
  environment: "test",
  autocompleteMicrosPerLookup: 2000,
  validationMicrosPerLookup: 2000,
  monthlyCapMicros: 50_000_000,
  lastSuccessfulAt: null,
  lastError: null,
  lastCheckedAt: null,
  health: "unconfigured",
});

function settingsKey() {
  return "smarty:" + environment();
}

export function validateSmartyConfig(value: unknown): SmartyConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError("Invalid Smarty configuration.");
  const c = value as Partial<SmartyConfig>;
  const base = defaultSmartyConfig();
  const next: SmartyConfig = {
    ...base,
    enabled: c.enabled === true,
    environment: c.environment === "live" ? "live" : "test",
    autocompleteMicrosPerLookup: Number(c.autocompleteMicrosPerLookup ?? base.autocompleteMicrosPerLookup),
    validationMicrosPerLookup: Number(c.validationMicrosPerLookup ?? base.validationMicrosPerLookup),
    monthlyCapMicros: Number(c.monthlyCapMicros ?? base.monthlyCapMicros),
    lastSuccessfulAt: typeof c.lastSuccessfulAt === "string" ? c.lastSuccessfulAt : null,
    lastError: typeof c.lastError === "string" ? c.lastError.slice(0, 500) : null,
    lastCheckedAt: typeof c.lastCheckedAt === "string" ? c.lastCheckedAt : null,
    health:
      c.health === "healthy" ||
      c.health === "degraded" ||
      c.health === "action_required" ||
      c.health === "disabled" ||
      c.health === "unconfigured"
        ? c.health
        : "unconfigured",
  };
  for (const k of [
    "autocompleteMicrosPerLookup",
    "validationMicrosPerLookup",
    "monthlyCapMicros",
  ] as const) {
    if (!Number.isSafeInteger(next[k]) || next[k] < 0 || next[k] > 1_000_000_000_000)
      throw new ApiError("Invalid Smarty cost or budget setting.");
  }
  // Never auto-enable from partial payloads; credentials + explicit enable required.
  if (next.enabled && next.environment === "live" && process.env.SMARTY_ALLOW_LIVE !== "true") {
    // Live mode is recorded for display, but enablement still requires vault credentials.
  }
  return next;
}

export async function smartyConfiguration(): Promise<SmartyConfig> {
  const { rows } = await getPool().query(
    "SELECT value FROM private.platform_settings WHERE key=$1",
    [settingsKey()],
  );
  if (!rows[0]) return defaultSmartyConfig();
  return validateSmartyConfig(rows[0].value);
}

export async function saveSmartyConfiguration(
  patch: Partial<SmartyConfig>,
  actor: string,
): Promise<SmartyConfig> {
  const current = await smartyConfiguration();
  const next = validateSmartyConfig({ ...current, ...patch });
  const authId = await integrationValue("SMARTY_AUTH_ID");
  const authToken = await integrationValue("SMARTY_AUTH_TOKEN");
  if (next.enabled && (!authId || !authToken))
    throw new ApiError("Add Smarty Auth ID and Auth Token in Connections before enabling.", 409);
  // Reconcile health with live vault state. Re-enable never revives Connected from a prior success —
  // require a fresh authenticated test. Already-enabled healthy configs stay healthy on unrelated saves.
  if (!authId || !authToken) next.health = "unconfigured";
  else if (!next.enabled) next.health = "disabled";
  else if (next.health === "unconfigured" || next.health === "disabled") next.health = "degraded";
  await getPool().query(
    `INSERT INTO private.platform_settings(key,value,updated_at) VALUES($1,$2,now())
     ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=now()`,
    [settingsKey(), JSON.stringify(next)],
  );
  await getPool().query(
    "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
    [
      actor,
      "smarty_config_updated",
      JSON.stringify({
        enabled: next.enabled,
        environment: next.environment,
        health: next.health,
      }),
    ],
  );
  return next;
}

export async function smartyCredentials() {
  const [authId, authToken, embeddedKey] = await Promise.all([
    integrationValue("SMARTY_AUTH_ID"),
    integrationValue("SMARTY_AUTH_TOKEN"),
    integrationValue("SMARTY_EMBEDDED_KEY"),
  ]);
  return {
    authId: authId.trim(),
    authToken: authToken.trim(),
    embeddedKey: embeddedKey.trim(),
    configured: Boolean(authId.trim() && authToken.trim()),
  };
}

export async function markSmartyHealth(
  patch: Pick<SmartyConfig, "health" | "lastError" | "lastSuccessfulAt" | "lastCheckedAt">,
) {
  // Merge only health fields so concurrent admin enable/cap edits are not overwritten.
  const healthPatch = {
    health: patch.health,
    lastError: patch.lastError,
    lastSuccessfulAt: patch.lastSuccessfulAt,
    lastCheckedAt: patch.lastCheckedAt,
  };
  const defaults = { ...defaultSmartyConfig(), ...healthPatch };
  await getPool().query(
    `INSERT INTO private.platform_settings(key,value,updated_at) VALUES($1,$2::jsonb,now())
     ON CONFLICT(key) DO UPDATE SET
       value = private.platform_settings.value || $3::jsonb,
       updated_at = now()`,
    [settingsKey(), JSON.stringify(defaults), JSON.stringify(healthPatch)],
  );
}
