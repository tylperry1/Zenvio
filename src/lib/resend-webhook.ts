import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SECONDS = 5 * 60;

export function verifyResendWebhook(input: {
  payload: string;
  id: string;
  timestamp: string;
  signature: string;
  secret: string;
  now?: number;
}) {
  if (!/^msg_[A-Za-z0-9_-]{8,}$/.test(input.id)) return false;
  const seconds = Number(input.timestamp);
  if (!Number.isInteger(seconds)) return false;
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(now - seconds) > MAX_SKEW_SECONDS) return false;
  const encodedSecret = input.secret.startsWith("whsec_")
    ? input.secret.slice(6)
    : input.secret;
  let key: Buffer;
  try {
    key = Buffer.from(encodedSecret, "base64");
  } catch {
    return false;
  }
  if (!key.length) return false;
  const expected = createHmac("sha256", key)
    .update(`${input.id}.${input.timestamp}.${input.payload}`)
    .digest("base64");
  return input.signature.split(" ").some((item) => {
    const [version, value] = item.split(",", 2);
    if (version !== "v1" || !value) return false;
    const left = Buffer.from(expected);
    const right = Buffer.from(value);
    return left.length === right.length && timingSafeEqual(left, right);
  });
}

export function resendDeliveryState(type: string) {
  if (type === "email.delivered") return "delivered";
  if (type === "email.bounced") return "bounced";
  if (type === "email.complained") return "complained";
  if (type === "email.suppressed") return "suppressed";
  if (type === "email.delivery_delayed") return "delayed";
  if (type === "email.failed") return "failed";
  return null;
}
