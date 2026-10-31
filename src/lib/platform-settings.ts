import { individualOffer, teamOffer, extraSeatOffer } from "./subscription-offers.mjs";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { getPool } from "./db";
export const integrationFields = {
  RESEND_API_KEY: "Resend API key",
  RESEND_WEBHOOK_SECRET: "Resend webhook signing secret",
  AUTH_EMAIL_FROM: "Verified sender email",
  STRIPE_SECRET_KEY: "Stripe secret key",
  STRIPE_GROWTH_WEBHOOK_SECRET: "Stripe customer-product webhook signing secret",
  STRIPE_CONNECT_WEBHOOK_SECRET:
    "Stripe Connect appointment-payment webhook signing secret",
  STRIPE_WEBHOOK_SECRET: "Stripe subscription webhook signing secret",
  STRIPE_MARKETPLACE_WEBHOOK_SECRET:
    "Stripe marketplace webhook signing secret",
  GOOGLE_CLIENT_ID: "Google OAuth client ID",
  GOOGLE_CLIENT_SECRET: "Google OAuth client secret",
  MICROSOFT_CLIENT_ID: "Microsoft OAuth client ID",
  MICROSOFT_CLIENT_SECRET: "Microsoft OAuth client secret",
  TWILIO_ACCOUNT_SID: "Twilio account SID",
  TWILIO_AUTH_TOKEN: "Twilio auth token",
  TWILIO_SENDER_NUMBER: "Twilio sender number",
  TWILIO_MESSAGING_SERVICE_SID: "Twilio messaging service SID",
  TURNSTILE_SITE_KEY: "Cloudflare Turnstile site key (booking CAPTCHA)",
  TURNSTILE_SECRET_KEY: "Cloudflare Turnstile secret key (booking CAPTCHA)",
  GEMINI_API_KEY: "Google Gemini API key",
  CLOUDFLARE_AI_TOKEN: "Cloudflare Workers AI API token",
  CLOUDFLARE_ACCOUNT_ID: "Cloudflare account ID",
  TELNYX_API_KEY: "Telnyx API key",
  TELNYX_PUBLIC_KEY: "Telnyx webhook Ed25519 public key",
  DAILY_API_KEY: "Daily API key",
  PRINTFUL_API_KEY: "Printful private store token",
  UPLOAD_SCANNER_KEY: "Private upload scanner API key",
  R2_ACCESS_KEY_ID: "Cloudflare R2 access key ID",
  R2_SECRET_ACCESS_KEY: "Cloudflare R2 secret access key",
  R2_ACCOUNT_ID: "Cloudflare R2 account ID",
  R2_BUCKET: "Cloudflare R2 private bucket",
  ANTHROPIC_API_KEY: "Anthropic API key (Zenvio Assistant)",
} as const;
export type IntegrationKey = keyof typeof integrationFields;
function key() {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret) throw new Error("Integration encryption is not configured.");
  return createHash("sha256").update(secret).digest();
}
export async function integrationValue(name: IntegrationKey) {
  const { rows } = await getPool().query(
    "SELECT ciphertext FROM private.integration_secrets WHERE key=$1",
    [name],
  );
  if (!rows[0]) return process.env[name] || "";
  return unsealSecret(rows[0].ciphertext);
}
export function sealSecret(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((x) => x.toString("base64"))
    .join(".");
}
export function unsealSecret(ciphertext: string) {
  const [iv, tag, data] = ciphertext.split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final(),
  ]).toString();
}
export async function saveIntegration(
  name: IntegrationKey,
  value: string,
  actor: string,
) {
  const ciphertext = sealSecret(value);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO private.integration_secrets(key,ciphertext) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET ciphertext=$2,updated_at=now()",
      [name, ciphertext],
    );
    await client.query(
      "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
      [actor, "integration_updated", JSON.stringify({ key: name })],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function pricing() {
  const { rows } = await getPool().query(
    "SELECT value FROM private.platform_settings WHERE key='pricing'",
  );
  return [...(rows[0]?.value || []).filter((p: {id:string}) => !["individual", "team", "team_extra"].includes(p.id)), individualOffer, teamOffer, extraSeatOffer];
}
