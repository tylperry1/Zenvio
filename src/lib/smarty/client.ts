import { getPool } from "../db";
import { ApiError } from "../server";
import { formatAddress, parseAddressInput, type StructuredAddress } from "../addresses";
import {
  markSmartyHealth,
  smartyConfiguration,
  smartyCredentials,
  type SmartyConfig,
} from "./config";
import { recordSmartyUsage } from "./usage";

/** Official Smarty US Autocomplete Pro host — https://www.smarty.com/docs/cloud/us-autocomplete-pro-api */
const AUTOCOMPLETE_URL = "https://us-autocomplete-pro.api.smarty.com/lookup";
/** Official Smarty US Street Address API host — https://www.smarty.com/docs/cloud/us-street-api */
const STREET_URL = "https://us-street.api.smarty.com/street-address";

export type SmartySuggestion = {
  streetLine: string;
  secondary: string;
  city: string;
  state: string;
  zipcode: string;
  entries: number;
  source?: string;
};

export class SmartyError extends Error {
  constructor(
    public category:
      | "invalid_credentials"
      | "payment_required"
      | "rate_limited"
      | "bad_request"
      | "unavailable"
      | "network"
      | "disabled"
      | "unknown",
    message: string,
    public statusCode?: number,
  ) {
    super(message);
  }
}

async function logError(
  operation: "autocomplete" | "validate" | "health",
  error: SmartyError,
) {
  try {
    await getPool().query(
      "INSERT INTO private.smarty_api_errors(operation,status_code,category,message) VALUES($1,$2,$3,$4)",
      [operation, error.statusCode ?? null, error.category, error.message.slice(0, 500)],
    );
  } catch {
    /* best-effort */
  }
}

function mapStatus(status: number, body: string): SmartyError {
  if (status === 401)
    return new SmartyError("invalid_credentials", "Smarty rejected the credentials.", status);
  if (status === 402)
    return new SmartyError(
      "payment_required",
      "Smarty subscription is inactive or out of lookups.",
      status,
    );
  if (status === 429)
    return new SmartyError("rate_limited", "Smarty rate limit reached. Try again shortly.", status);
  if (status === 400 || status === 422) {
    void body;
    return new SmartyError("bad_request", "Smarty could not process that address request.", status);
  }
  if (status >= 500)
    return new SmartyError("unavailable", "Smarty is temporarily unavailable.", status);
  void body;
  return new SmartyError("unknown", `Smarty error ${status}`, status);
}

async function requireReady(): Promise<{
  config: SmartyConfig;
  authId: string;
  authToken: string;
}> {
  const [config, creds] = await Promise.all([smartyConfiguration(), smartyCredentials()]);
  if (!creds.configured)
    throw new SmartyError("invalid_credentials", "Smarty credentials are not configured.");
  if (!config.enabled)
    throw new SmartyError("disabled", "Smarty address services are disabled.");
  return { config, authId: creds.authId, authToken: creds.authToken };
}

function authQuery(authId: string, authToken: string) {
  return `auth-id=${encodeURIComponent(authId)}&auth-token=${encodeURIComponent(authToken)}`;
}

async function executeLookup(input: {
  url: string;
  operation: "autocomplete" | "validate";
  workspaceId: string;
  config: SmartyConfig;
}) {
  const micros =
    input.operation === "validate"
      ? input.config.validationMicrosPerLookup
      : input.config.autocompleteMicrosPerLookup;
  await recordSmartyUsage({
    workspaceId: input.workspaceId,
    micros,
    operation: input.operation,
    platformCap: input.config.monthlyCapMicros,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(input.url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) {
      const err = mapStatus(response.status, text);
      await logError(input.operation, err);
      await markSmartyHealth({
        health: err.category === "invalid_credentials" ? "action_required" : "degraded",
        lastError: err.message,
        lastCheckedAt: new Date().toISOString(),
        lastSuccessfulAt: input.config.lastSuccessfulAt,
      });
      throw err;
    }
    await markSmartyHealth({
      health: "healthy",
      lastError: null,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessfulAt: new Date().toISOString(),
    });
    return text;
  } catch (e) {
    if (e instanceof SmartyError) throw e;
    const err = new SmartyError(
      "network",
      e instanceof Error && e.name === "AbortError"
        ? "Smarty request timed out."
        : "Unable to reach Smarty.",
    );
    await logError(input.operation, err);
    await markSmartyHealth({
      health: "degraded",
      lastError: err.message,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessfulAt: input.config.lastSuccessfulAt,
    });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function smartyAutocomplete(input: {
  search: string;
  selected?: string;
  maxResults?: number;
  workspaceId: string;
  preferGeolocation?: "city" | "none";
}): Promise<{ suggestions: SmartySuggestion[]; available: boolean; message?: string }> {
  const search = input.search.trim().slice(0, 32);
  if (search.length < 3) return { suggestions: [], available: true };
  try {
    const ready = await requireReady();
    const params = new URLSearchParams();
    params.set("search", search);
    params.set("max_results", String(Math.min(10, Math.max(1, input.maxResults ?? 8))));
    params.set("prefer_geolocation", input.preferGeolocation === "none" ? "none" : "city");
    params.set("source", "all");
    if (input.selected) params.set("selected", input.selected.slice(0, 200));
    const url = `${AUTOCOMPLETE_URL}?${authQuery(ready.authId, ready.authToken)}&${params.toString()}`;
    const text = await executeLookup({
      url,
      operation: "autocomplete",
      workspaceId: input.workspaceId,
      config: ready.config,
    });
    const data = JSON.parse(text) as { suggestions?: Array<Record<string, unknown>> };
    const suggestions = (data.suggestions || []).map((s) => ({
      streetLine: String(s.street_line || ""),
      secondary: String(s.secondary || ""),
      city: String(s.city || ""),
      state: String(s.state || ""),
      zipcode: String(s.zipcode || ""),
      entries: Number(s.entries || 0),
      source: s.source ? String(s.source) : undefined,
    }));
    return { suggestions, available: true };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    return {
      suggestions: [],
      available: false,
      message: "Address autocomplete is temporarily unavailable. Enter the address manually.",
    };
  }
}

export async function smartyValidateAddress(input: {
  address: Partial<StructuredAddress>;
  workspaceId: string;
}): Promise<{
  available: boolean;
  validated: boolean;
  address: StructuredAddress;
  message?: string;
  candidates?: StructuredAddress[];
}> {
  const draft = parseAddressInput(input.address);
  try {
    const ready = await requireReady();
    const params = new URLSearchParams();
    params.set("street", draft.street);
    if (draft.street2) params.set("secondary", draft.street2);
    if (draft.city) params.set("city", draft.city);
    if (draft.state) params.set("state", draft.state);
    if (draft.postalCode) params.set("zipcode", draft.postalCode);
    params.set("candidates", "5");
    params.set("match", "enhanced");
    const url = `${STREET_URL}?${authQuery(ready.authId, ready.authToken)}&${params.toString()}`;
    const text = await executeLookup({
      url,
      operation: "validate",
      workspaceId: input.workspaceId,
      config: ready.config,
    });
    const rows = JSON.parse(text) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || !rows.length) {
      return {
        available: true,
        validated: false,
        address: draft,
        message: "Address could not be verified. You can still continue with the entered address.",
      };
    }
    const matched = rows.filter((row) => {
      const analysis = (row.analysis || {}) as Record<string, unknown>;
      // match=enhanced can return a row with enhanced_match "none" for non-addresses.
      return String(analysis.enhanced_match || "") !== "none";
    });
    if (!matched.length) {
      return {
        available: true,
        validated: false,
        address: draft,
        message: "Address could not be verified. You can still continue with the entered address.",
      };
    }
    const candidates = matched.map((row) => {
      const components = (row.components || {}) as Record<string, unknown>;
      const street = [
        components.primary_number,
        components.street_predirection,
        components.street_name,
        components.street_suffix,
        components.street_postdirection,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();
      const street2 = [components.secondary_designator, components.secondary_number]
        .filter(Boolean)
        .join(" ")
        .trim();
      const parsed = parseAddressInput({
        street: street || draft.street,
        street2: street2 || draft.street2,
        city: components.city_name || draft.city,
        state: components.state_abbreviation || draft.state,
        postalCode: [components.zipcode, components.plus4_code ? `-${components.plus4_code}` : ""]
          .join("")
          .replace(/-$/, ""),
        country: "US",
        smartyKey: row.smarty_key || "",
        validated: true,
        source: "smarty",
        accessInstructions: draft.accessInstructions,
      });
      parsed.formatted = formatAddress(parsed);
      return parsed;
    });
    return { available: true, validated: true, address: candidates[0], candidates };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    return {
      available: false,
      validated: false,
      address: draft,
      message: "Address validation is temporarily unavailable. Your entered address was kept.",
    };
  }
}

export async function testSmartyConnection(): Promise<{
  ok: boolean;
  message: string;
  checkedAt: string;
}> {
  const checkedAt = new Date().toISOString();
  const [creds, config] = await Promise.all([smartyCredentials(), smartyConfiguration()]);
  if (!creds.configured) {
    await markSmartyHealth({
      health: "unconfigured",
      lastError: "Missing Auth ID or Auth Token",
      lastCheckedAt: checkedAt,
      lastSuccessfulAt: config.lastSuccessfulAt,
    });
    return { ok: false, message: "Add Smarty Auth ID and Auth Token first.", checkedAt };
  }
  const params = new URLSearchParams({
    street: "1 Santa Claus Ln",
    city: "North Pole",
    state: "AK",
    zipcode: "99705",
    candidates: "1",
  });
  const url = `${STREET_URL}?${authQuery(creds.authId, creds.authToken)}&${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) {
      const err = mapStatus(response.status, text);
      await logError("health", err);
      await markSmartyHealth({
        health: "action_required",
        lastError: err.message,
        lastCheckedAt: checkedAt,
        lastSuccessfulAt: config.lastSuccessfulAt,
      });
      return { ok: false, message: err.message, checkedAt };
    }
    await markSmartyHealth({
      health: config.enabled ? "healthy" : "disabled",
      lastError: null,
      lastCheckedAt: checkedAt,
      lastSuccessfulAt: checkedAt,
    });
    return {
      ok: true,
      message: config.enabled
        ? "Smarty connection succeeded."
        : "Credentials work. Integration remains disabled until enabled.",
      checkedAt,
    };
  } catch (e) {
    const message =
      e instanceof Error && e.name === "AbortError"
        ? "Smarty health check timed out."
        : "Unable to reach Smarty.";
    await logError("health", new SmartyError("network", message));
    await markSmartyHealth({
      health: "degraded",
      lastError: message,
      lastCheckedAt: checkedAt,
      lastSuccessfulAt: config.lastSuccessfulAt,
    });
    return { ok: false, message, checkedAt };
  } finally {
    clearTimeout(timer);
  }
}
