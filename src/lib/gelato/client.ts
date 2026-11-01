import { getPool } from "../db";
import { integrationValue } from "../platform-settings";
import { GELATO_HOSTS, GelatoError, classifyHttpFailure, redact, type GelatoErrorCategory } from "./core";

// Server-only Gelato transport. The API key comes from the encrypted
// integration vault (falling back to the GELATO_API_KEY environment variable)
// and is only ever placed in the X-API-KEY request header.

type Fetch = typeof fetch;
let transport: Fetch = (...args) => fetch(...args);
/** Test hook: substitute the network layer. */
export function setGelatoTransport(next: Fetch | null) {
  transport = next || ((...args) => fetch(...args));
}

export async function gelatoKeyConfigured() {
  return Boolean((await integrationValue("GELATO_API_KEY")).trim());
}

export type GelatoRequest = {
  host: keyof typeof GELATO_HOSTS;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  operation: string;
  orderId?: string;
  timeoutMs?: number;
};

export async function gelatoRequest<T = unknown>(req: GelatoRequest): Promise<T> {
  const key = (await integrationValue("GELATO_API_KEY")).trim();
  if (!key) throw new GelatoError("invalid_credentials", "Gelato API key is not configured.");
  let response: Response;
  try {
    response = await transport(GELATO_HOSTS[req.host] + req.path, {
      method: req.method || "GET",
      headers: {
        "X-API-KEY": key,
        Accept: "application/json",
        ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(req.timeoutMs ?? 15000),
      cache: "no-store",
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    const error = new GelatoError("network", timeout ? "Gelato did not respond in time." : "Could not reach Gelato.");
    await recordError(req, error);
    throw error;
  }
  const text = await response.text().catch(() => "");
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const error = classifyHttpFailure(response.status, data, response.headers.get("retry-after"));
    await recordError(req, error);
    throw error;
  }
  if (text && data === null) {
    const error = new GelatoError("invalid_response", "Gelato returned an unreadable response.", response.status);
    await recordError(req, error);
    throw error;
  }
  // Any authenticated success restores health after transient errors (throttled writes).
  await getPool()
    .query(
      "UPDATE private.supplier_integrations SET status='connected',last_success_at=now(),updated_at=now() WHERE provider='gelato' AND (status<>'connected' OR last_success_at IS NULL OR last_success_at<now()-interval '5 minutes')",
    )
    .catch(() => {});
  return data as T;
}

const integrationStatus: Partial<Record<GelatoErrorCategory, string>> = {
  invalid_credentials: "invalid_credentials",
  rate_limited: "rate_limited",
  unavailable: "unavailable",
  network: "unavailable",
};

async function recordError(req: GelatoRequest, error: GelatoError) {
  try {
    const message = redact(error.message).slice(0, 500);
    await getPool().query(
      "INSERT INTO private.supplier_api_errors(provider,operation,status_code,category,message,order_id) VALUES('gelato',$1,$2,$3,$4,$5)",
      [req.operation.slice(0, 80), error.status, error.category, message, req.orderId || null],
    );
    await getPool().query(
      "UPDATE private.supplier_integrations SET last_error=$1,last_error_at=now(),status=COALESCE($2,status),updated_at=now() WHERE provider='gelato'",
      [message, integrationStatus[error.category] || null],
    );
  } catch {
    // Logging must never mask the original provider error.
  }
}

export async function recordSuccess() {
  await getPool().query(
    "UPDATE private.supplier_integrations SET status='connected',last_success_at=now(),last_checked_at=now(),updated_at=now() WHERE provider='gelato'",
  );
}
