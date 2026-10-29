import { integrationValue } from "./platform-settings";
import { getPool } from "./db";
export class ResendDeliveryError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export function resendFailure(status: number, body: any) {
  const name = typeof body?.name === "string" ? body.name : "",
    message =
      typeof body?.message === "string" ? body.message.toLowerCase() : "";
  if (message.includes("only send testing emails"))
    return new ResendDeliveryError(
      "test_sender_restricted",
      "Resend’s test sender can only email the account owner. Set a sender on your verified domain in Integrations.",
    );
  if (/domain.*not verified|verify.*domain/.test(message))
    return new ResendDeliveryError(
      "sender_domain_unverified",
      "The sender domain is not verified in Resend. Verify its DNS records and use that exact domain in the sender address.",
    );
  if (
    (message.includes("api key") &&
      /invalid|not active|suspend/.test(message)) ||
    name === "suspended_api_key" ||
    name === "missing_api_key"
  )
    return new ResendDeliveryError(
      "api_key_rejected",
      "Resend rejected the configured API key. Check that the saved key is active and belongs to the correct Resend account.",
    );
  if (name === "restricted_api_key" || name === "invalid_permission")
    return new ResendDeliveryError(
      "key_permission_denied",
      "The configured Resend key cannot perform this email action. Review its sending permissions and domain restrictions.",
    );
  if (message.includes("from") && /invalid|format/.test(message))
    return new ResendDeliveryError(
      "invalid_sender",
      "The sender address has an invalid format. Use Name <address@verified-domain.com> or a plain verified-domain email.",
    );
  if (name === "invalid_idempotent_request")
    return new ResendDeliveryError(
      "idempotency_conflict",
      "The provider has a different request for this delivery key. Review provider history before resending.",
    );
  if (/quota/.test(name))
    return new ResendDeliveryError(
      "provider_quota_exceeded",
      "Resend’s sending quota has been reached. Review provider usage before retrying.",
    );
  if (status === 429 || name === "rate_limit_exceeded")
    return new ResendDeliveryError(
      "provider_rate_limited",
      "Resend temporarily rate limited delivery. A retry is scheduled.",
      true,
    );
  if (status >= 500 || name === "concurrent_idempotent_requests")
    return new ResendDeliveryError(
      "provider_unavailable",
      "Resend is temporarily unavailable. A retry is scheduled.",
      true,
    );
  return new ResendDeliveryError(
    "provider_rejected",
    "Resend rejected the email. Review sender and recipient formats and the provider delivery log.",
  );
}
export async function emailDiagnostics() {
  const [key, from] = await Promise.all([
    integrationValue("RESEND_API_KEY"),
    integrationValue("AUTH_EMAIL_FROM"),
  ]);
  const sender = from
    .trim()
    .match(/^(?:[^<>]*<([^<>\s]+@[^<>\s]+)>|([^<>\s]+@[^<>\s]+))$/);
  const address = sender?.[1] || sender?.[2],
    domain = address?.split("@")[1]?.toLowerCase() || null;
  const counts = (
    await getPool().query(
      "SELECT status,count(*)::int count,count(*) FILTER(WHERE run_at<=now())::int due FROM private.delivery_jobs GROUP BY status",
    )
  ).rows;
  const codes = (
    await getPool().query(
      "SELECT DISTINCT provider_status FROM private.delivery_jobs WHERE status IN ('failed','uncertain') AND provider_status IS NOT NULL LIMIT 20",
    )
  ).rows
    .map((r) => r.provider_status)
    .filter((v) => /^[a-z_]{1,60}$/.test(v));
  const result = {
    configured: !!key.trim() && !!from.trim(),
    senderDomain: domain,
    credentialStatus: "not_checked",
    domainStatus: domain === "resend.dev" ? "test_sender" : "not_checked",
    issue: !domain
      ? "Sender address is missing or has an invalid format."
      : domain === "resend.dev"
        ? "The Resend test sender is restricted to the account owner. Use a verified domain for customer email."
        : (null as string | null),
    queue: counts,
    failureCodes: codes,
  };
  if (!result.configured) return result;
  try {
    let after = "";
    for (let page = 0; page < 5; page++) {
      const query = new URLSearchParams({
        limit: "100",
        ...(after ? { after } : {}),
      });
      const r = await fetch("https://api.resend.com/domains?" + query, {
          headers: { Authorization: "Bearer " + key.trim() },
          signal: AbortSignal.timeout(8000),
          redirect: "error",
        }),
        data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (
          data.name === "restricted_api_key" &&
          /only send/i.test(data.message || "")
        ) {
          result.credentialStatus = "sending_only";
          return result;
        }
        const error = resendFailure(r.status, data);
        result.credentialStatus = error.retryable ? "unavailable" : "rejected";
        result.issue = error.message;
        return result;
      }
      result.credentialStatus = "accepted";
      const match = (data.data || []).find(
        (d: any) => String(d.name).toLowerCase() === domain,
      );
      if (match) {
        result.domainStatus =
          match.status === "verified" &&
          match.capabilities?.sending !== "disabled"
            ? "verified"
            : "unverified";
        if (result.domainStatus === "unverified")
          result.issue =
            "The sender domain is not verified for sending in Resend.";
        return result;
      }
      if (!data.has_more) {
        if (domain !== "resend.dev") {
          result.domainStatus = "not_listed";
          result.issue =
            "The configured sender domain is not listed in this Resend account. Verify it or select a sender on a verified domain.";
        }
        return result;
      }
      after = data.data?.at(-1)?.id;
      if (!after) break;
    }
    result.domainStatus = "not_checked";
    return result;
  } catch {
    result.credentialStatus = "unavailable";
    result.issue =
      "Resend diagnostics are temporarily unavailable. Existing credentials were preserved.";
    return result;
  }
}
