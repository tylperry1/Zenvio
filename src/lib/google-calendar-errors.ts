export type CalendarIssue = { code: string; message: string; status: number };
export function calendarIssue(
  status: number,
  data: unknown = {},
): CalendarIssue {
  const value = data as {
    error?: {
      status?: string;
      errors?: { reason?: string }[];
      details?: { reason?: string }[];
    };
  };
  const reasons = [
    value?.error?.status,
    ...(value?.error?.errors || []).map((e) => e.reason),
    ...(value?.error?.details || []).map((e) => e.reason),
  ];
  if (
    reasons.some((r) =>
      ["SERVICE_DISABLED", "accessNotConfigured", "serviceDisabled"].includes(
        r || "",
      ),
    )
  )
    return {
      code: "api_disabled",
      status,
      message:
        "Google Calendar API is disabled for the OAuth client’s Google Cloud project. The platform administrator must enable Google Calendar API in that same project.",
    };
  if (status === 401)
    return {
      code: "reconnect_required",
      status,
      message:
        "Google authorization has expired or was revoked. Reconnect this Google account.",
    };
  if (
    reasons.some((r) =>
      ["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"].includes(
        r || "",
      ),
    )
  )
    return {
      code: "permissions_missing",
      status,
      message:
        "Google Calendar permissions are missing. Reconnect this account and approve all requested calendar permissions.",
    };
  if (
    status === 429 ||
    reasons.some((r) =>
      [
        "rateLimitExceeded",
        "userRateLimitExceeded",
        "quotaExceeded",
        "RESOURCE_EXHAUSTED",
      ].includes(r || ""),
    )
  )
    return {
      code: "rate_limited",
      status,
      message:
        "Google Calendar is temporarily limiting requests. Wait a few minutes, then check the connection again.",
    };
  if (status === 403)
    return {
      code: "access_denied",
      status,
      message:
        "Google denied calendar access. Check this account’s Calendar access and Google Workspace app restrictions, then reconnect if needed.",
    };
  if (status === 404)
    return {
      code: "calendar_missing",
      status,
      message:
        "Google could not find this account’s primary calendar. Open Google Calendar with this account to finish setup, then check again.",
    };
  return {
    code: "provider_unavailable",
    status,
    message:
      "Google Calendar could not be reached or returned an invalid availability response. Try the connection check again shortly.",
  };
}
