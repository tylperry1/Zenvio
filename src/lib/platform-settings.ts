import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { getPool } from "./db";
export const integrationFields = {
  RESEND_API_KEY: "Resend API key",
  AUTH_EMAIL_FROM: "Verified sender email",
  STRIPE_SECRET_KEY: "Stripe secret key",
  STRIPE_CONNECT_WEBHOOK_SECRET:
    "Stripe Connect appointment-payment webhook signing secret",
  STRIPE_WEBHOOK_SECRET: "Stripe subscription webhook signing secret",
  STRIPE_MARKETPLACE_WEBHOOK_SECRET:
    "Stripe marketplace webhook signing secret",
  GOOGLE_CLIENT_ID: "Google OAuth client ID",
  GOOGLE_CLIENT_SECRET: "Google OAuth client secret",
  MICROSOFT_CLIENT_ID: "Microsoft OAuth client ID",
  MICROSOFT_CLIENT_SECRET: "Microsoft OAuth client secret",
  TURNSTILE_SITE_KEY: "Cloudflare Turnstile site key (booking CAPTCHA)",
  TURNSTILE_SECRET_KEY: "Cloudflare Turnstile secret key (booking CAPTCHA)",
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
  return rows[0]?.value || [];
}
