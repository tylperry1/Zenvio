import { queueSms, telnyxReadiness } from "./launch/sms-outbox";
// SMS transport contract consumed by the messaging center and the assistant.
//
// SMS delivery, Twilio, sender numbers, consent records and message balances are owned by
// the shared messaging backend (Codex workstream). Until that transport is merged, this
// TEMPORARY adapter reports SMS as unavailable so no screen or assistant action claims an
// SMS was sent. Replace `transport` with the shared implementation; the shape below is the
// whole surface the product code depends on.
export type SmsBlockedReason =
  | "provider_disabled"
  | "no_consent"
  | "no_balance"
  | "no_phone"
  | "invalid_phone";
export type SmsReadiness =
  | { ok: true; sender: string; preview: string }
  | { ok: false; reason: SmsBlockedReason; detail: string };
export type SmsSendResult = {
  status: "queued" | "sent" | "delivered" | "failed";
  providerId: string | null;
  detail?: string;
};
export interface SmsTransport {
  readiness(input: { userId: string; to: string; body: string }): Promise<SmsReadiness>;
  send(input: { userId: string; to: string; body: string; reference: string }): Promise<SmsSendResult>;
}

export const smsBlockedCopy: Record<SmsBlockedReason, string> = {
  provider_disabled: "Text messaging isn’t connected for this workspace yet. Send by email or through the client portal instead.",
  no_consent: "This client hasn’t agreed to receive text messages.",
  no_balance: "Your text message balance is empty. Add credits before sending.",
  no_phone: "There’s no mobile number on file for this client.",
  invalid_phone: "That phone number can’t receive text messages.",
};

const unavailable: SmsTransport = {
  async readiness() {
    return { ok: false, reason: "provider_disabled", detail: smsBlockedCopy.provider_disabled };
  },
  async send() {
    throw new Error("sms_transport_unavailable");
  },
};

const shared: SmsTransport = {readiness:telnyxReadiness,send:queueSms};
let transport: SmsTransport = shared;
// Hook for the shared transport (and tests) to register the real implementation.
export function registerSmsTransport(next: SmsTransport | null) {
  transport = next ?? unavailable;
}
export function smsTransport() {
  return transport;
}

export function normalizePhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  const bare = digits.replace(/\D/g, "");
  if (bare.length === 10) return "+1" + bare;
  if (bare.length === 11 && bare.startsWith("1")) return "+" + bare;
  return null;
}

export async function smsReadiness(userId: string, phone: string, body: string): Promise<SmsReadiness> {
  // Report the workspace-wide blocker first so screens don't ask for a phone number that can't be used.
  if (transport === unavailable)
    return { ok: false, reason: "provider_disabled", detail: smsBlockedCopy.provider_disabled };
  if (!phone.trim()) return { ok: false, reason: "no_phone", detail: smsBlockedCopy.no_phone };
  const to = normalizePhone(phone);
  if (!to) return { ok: false, reason: "invalid_phone", detail: smsBlockedCopy.invalid_phone };
  return transport.readiness({ userId, to, body });
}
