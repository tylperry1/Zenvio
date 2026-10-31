import { createHmac, timingSafeEqual } from "node:crypto";
import { getPool } from "./db";
import { integrationValue } from "./platform-settings";
import { ApiError } from "./server";

export type TwilioKeyword = "stop" | "start" | "help" | null;

export function normalizeE164(value: string) {
  const phone = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone))
    throw new ApiError("Enter a valid phone number including country code.");
  return phone;
}

export function twilioKeyword(body: string): TwilioKeyword {
  const word = body.trim().toLowerCase();
  if (["stop", "stopall", "unsubscribe", "cancel", "end", "quit"].includes(word))
    return "stop";
  if (["start", "unstop", "yes"].includes(word)) return "start";
  if (["help", "info"].includes(word)) return "help";
  return null;
}

export function twilioSignatureValid(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string,
) {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature || "");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function twilioConfigured() {
  const [accountSid, authToken, sender, serviceSid] = await Promise.all([
    integrationValue("TWILIO_ACCOUNT_SID"),
    integrationValue("TWILIO_AUTH_TOKEN"),
    integrationValue("TWILIO_SENDER_NUMBER"),
    integrationValue("TWILIO_MESSAGING_SERVICE_SID"),
  ]);
  return Boolean(accountSid && authToken && (sender || serviceSid));
}

export async function assertSmsConsent(userId: string, phone: string) {
  const { rows } = await getPool().query(
    `select scope,status from private.contact_consents
      where user_id=$1 and phone_e164=$2 and scope in ('transactional','appointment')`,
    [userId, normalizeE164(phone)],
  );
  if (!rows.some((row) => row.status === "opted_in"))
    throw new ApiError("SMS consent is required before sending this message.", 409);
  if (rows.some((row) => row.status === "opted_out"))
    throw new ApiError("This contact has opted out of SMS.", 409);
}

async function assertSmsConnection(userId: string) {
  const { rows } = await getPool().query(
    `select sender_number,registration_state,messaging_enabled,country_code
       from private.sms_provider_connections where user_id=$1`,
    [userId],
  );
  const connection = rows[0];
  if (!connection?.messaging_enabled)
    throw new ApiError("SMS activation is incomplete for this business.", 503);
  if (
    connection.country_code === "US" &&
    !["approved", "not_required"].includes(connection.registration_state)
  )
    throw new ApiError("US messaging registration must be approved before sending.", 503);
  return connection;
}

export async function sendTwilioSms(input: {
  userId: string;
  to: string;
  body: string;
  statusCallback: string;
}) {
  if (process.env.TWILIO_MESSAGING_ENABLED !== "true")
    throw new ApiError("SMS is not active for this environment.", 503);
  const to = normalizeE164(input.to);
  if (!input.body.trim() || input.body.length > 1600)
    throw new ApiError("SMS messages must contain between 1 and 1,600 characters.");
  await assertSmsConsent(input.userId, to);
  const connection = await assertSmsConnection(input.userId);
  const [accountSid, authToken, sender, serviceSid] = await Promise.all([
    integrationValue("TWILIO_ACCOUNT_SID"),
    integrationValue("TWILIO_AUTH_TOKEN"),
    integrationValue("TWILIO_SENDER_NUMBER"),
    integrationValue("TWILIO_MESSAGING_SERVICE_SID"),
  ]);
  if (!accountSid || !authToken || (!sender && !serviceSid))
    throw new ApiError("Twilio SMS requires administrator configuration.", 503);
  const form = new URLSearchParams({
    To: to,
    Body: input.body.trim(),
    StatusCallback: input.statusCallback,
  });
  if (serviceSid) form.set("MessagingServiceSid", serviceSid);
  else {
    const configuredSender = normalizeE164(sender);
    if (configuredSender !== connection.sender_number)
      throw new ApiError("The configured SMS sender does not match this business.", 503);
    form.set("From", configuredSender);
  }
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    },
  );
  const result = (await response.json().catch(() => ({}))) as {
    sid?: string;
    status?: string;
    code?: number;
  };
  if (!response.ok || !result.sid)
    throw new ApiError(
      response.status === 429
        ? "Twilio is rate limiting SMS. Try again later."
        : "Twilio rejected the SMS request. Review provider configuration.",
      response.status === 429 || response.status >= 500 ? 503 : 400,
    );
  return { providerMessageId: result.sid, state: result.status || "queued" };
}
