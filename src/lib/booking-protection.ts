import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getPool } from "./db";
import { integrationValue } from "./platform-settings";
import { ApiError } from "./server";

// Vercel sets x-forwarded-for; the first entry is the original client.
export function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function allowRequest(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
) {
  const key = createHash("sha256").update(scope + ":" + identifier).digest("hex");
  const { rows } = await getPool().query(
    `insert into private.request_limits(key,count,window_start) values($1,1,now())
     on conflict(key) do update set
       count=case when request_limits.window_start<now()-make_interval(secs=>$2) then 1 else request_limits.count+1 end,
       window_start=case when request_limits.window_start<now()-make_interval(secs=>$2) then now() else request_limits.window_start end
     returning count`,
    [key, windowSeconds],
  );
  // Occasionally clear stale windows so the table stays small.
  if (Math.random() < 0.01)
    await getPool().query(
      "delete from private.request_limits where window_start<now()-interval '2 days'",
    );
  return rows[0].count <= limit;
}

export async function captchaKeys() {
  const [site, secret] = await Promise.all([
    integrationValue("TURNSTILE_SITE_KEY"),
    integrationValue("TURNSTILE_SECRET_KEY"),
  ]);
  return site && secret ? { site, secret } : null;
}

export async function captchaSiteKey() {
  return (await captchaKeys())?.site || "";
}

async function verifyCaptcha(secret: string, token: unknown, ip: string) {
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({
        secret,
        response: token,
        ...(ip !== "unknown" ? { remoteip: ip } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
    const d = await r.json();
    return d.success === true;
  } catch {
    throw new ApiError("We couldn’t verify this request. Please try again.", 503);
  }
}

// Guards guest booking submissions: per-IP limits always, CAPTCHA when configured.
export async function protectBooking(request: NextRequest, captcha: unknown) {
  const ip = clientIp(request);
  const [hourly, daily] = await Promise.all([
    allowRequest("booking:hour", ip, 10, 3600),
    allowRequest("booking:day", ip, 40, 86400),
  ]);
  if (!hourly || !daily)
    throw new ApiError("Too many booking attempts. Please wait and try again.", 429);
  const keys = await captchaKeys();
  if (keys && !(await verifyCaptcha(keys.secret, captcha, ip)))
    throw new ApiError("Please complete the verification and try again.", 400);
}
