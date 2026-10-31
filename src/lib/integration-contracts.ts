/**
 * Shared Zenvio 2.1 integration contracts.
 *
 * Authorization rules are part of this API contract:
 * - `workspaceId` is always derived from the authenticated session on writes. A
 *   caller-supplied workspace ID is only a filter and never proof of access.
 * - Message/thread reads require workspace membership or a matching external
 *   participant token. Custom sends require an authenticated workspace member.
 * - Consent can be recorded by an authenticated workspace member or by a
 *   verified inbound provider event for the exact phone number.
 * - Provider health and AI read models contain no secrets. Platform-wide health,
 *   retry controls, feature flags, and credential mutations require master admin.
 * - AI actions are proposals until an authenticated user confirms the immutable
 *   proposal ID. Execution must re-check authorization and current record state.
 */

export type Channel = "email" | "sms";
export type MessageDirection = "inbound" | "outbound";

export type MessageDeliveryState =
  | "draft"
  | "queued"
  | "sending"
  | "provider_accepted"
  | "delivered"
  | "failed"
  | "suppressed"
  | "received";

export type MessagingParticipant = {
  contactId?: string;
  displayName?: string;
  email?: string;
  phoneE164?: string;
};

export type MessagingThread = {
  id: string;
  workspaceId: string;
  channel: Channel;
  participant: MessagingParticipant;
  subject?: string;
  latestMessageAt: string;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MessageRecord = {
  id: string;
  threadId: string;
  workspaceId: string;
  channel: Channel;
  direction: MessageDirection;
  state: MessageDeliveryState;
  body: string;
  provider?: "resend" | "twilio" | "telnyx";
  providerMessageId?: string;
  failureCode?: string;
  failureMessage?: string;
  sentAt?: string;
  deliveredAt?: string;
  receivedAt?: string;
  createdAt: string;
};

export type CommunicationTemplatePurpose =
  | "booking_link"
  | "appointment_confirmation"
  | "appointment_reminder"
  | "document_signing"
  | "payment_request"
  | "custom";

export type CommunicationTemplate = {
  id: string;
  workspaceId: string;
  channel: Channel;
  purpose: CommunicationTemplatePurpose;
  name: string;
  body: string;
  active: boolean;
  updatedAt: string;
};

export type SendMessageRequest = {
  channel: Channel;
  threadId?: string;
  contactId?: string;
  to: string;
  body?: string;
  templateId?: string;
  idempotencyKey: string;
  relatedRecord?: {
    type: "booking" | "document" | "payment";
    id: string;
  };
};

export type BookingLinkShareRequest = {
  channel: Channel;
  contactId?: string;
  to: string;
  bookingUrl: string;
  templateId?: string;
  idempotencyKey: string;
};

export type ConsentScope = "transactional" | "appointment" | "marketing";
export type ConsentStatus = "opted_in" | "opted_out";

export type ContactConsent = {
  id: string;
  workspaceId: string;
  contactId?: string;
  phoneE164: string;
  status: ConsentStatus;
  scopes: ConsentScope[];
  source:
    | "booking_form"
    | "written"
    | "verbal"
    | "keyword"
    | "import"
    | "admin";
  countryCode: string;
  recordedAt: string;
  revokedAt?: string;
};

export type ProviderConnectionHealth = {
  provider: "google_calendar" | "microsoft_calendar" | "resend" | "twilio" | "telnyx" | "daily" | "stripe";
  scope: "workspace" | "platform";
  workspaceId?: string;
  state: "unconfigured" | "connecting" | "healthy" | "degraded" | "action_required";
  lastSuccessfulOperationAt?: string;
  lastCheckedAt: string;
  issueCode?: string;
  action?: string;
};

export type AiAppointmentQuery = {
  workspaceId: string;
  from: string;
  to: string;
  statuses?: Array<"confirmed" | "cancelled">;
  contactId?: string;
};

export type AiAppointmentSummary = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "cancelled";
  contactId?: string;
  paymentState?: string;
};

export type AiCrmSummary = {
  contactId: string;
  displayName: string;
  company?: string;
  upcomingAppointmentCount: number;
  completedDocumentCount: number;
  outstandingDocumentCount: number;
  lastActivityAt?: string;
};

export type AiDocumentStatus = {
  id: string;
  title: string;
  status: "draft" | "sent" | "partially_signed" | "completed" | "voided";
  recipientCount: number;
  completedRecipientCount: number;
  expiresAt?: string;
};

export type AiActionKind =
  | "send_message"
  | "share_booking_link"
  | "send_document_reminder"
  | "reschedule_appointment"
  | "cancel_appointment";

export type AiActionProposal = {
  id: string;
  workspaceId: string;
  requestedBy: string;
  kind: AiActionKind;
  summary: string;
  payload: Record<string, unknown>;
  state: "proposed" | "confirmed" | "executed" | "rejected" | "expired";
  expiresAt: string;
  createdAt: string;
};

export type AiActionConfirmationRequest = {
  proposalId: string;
  confirmationToken: string;
};

export type AiActionExecutionResult = {
  proposalId: string;
  state: "executed" | "rejected" | "expired" | "conflict";
  recordId?: string;
  message: string;
};

