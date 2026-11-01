/** Additive 3.0 contracts; status does not imply provider acceptance. */
export type LaunchState = "disabled" | "unconfigured" | "implemented_unverified" | "verified" | "blocked";
export type AiProviderId = "anthropic" | "gemini" | "cloudflare";
export type AiProviderConfig = {
    enabled: boolean;
    provider: AiProviderId;
    model: string;
    toolCompatible: boolean;
    privateDataApproved: boolean;
    inputMicrosPerMillion: number;
    outputMicrosPerMillion: number;
    monthlyCapMicros: number;
    workspaceMonthlyCapMicros: number;
    maxOutputTokens: number;
    fallback: "none";
};
export type ProviderReadiness = {
    provider: string;
    state: LaunchState;
    configured: boolean;
    checkedAt: string;
    verifiedAt: string | null;
    blockers: string[];
};
export type BookingLink = {
    url: string;
    hostId: string;
    eventId: string | null;
    active: boolean;
};
export type WaitlistEntry = {
    id: string;
    eventId: string;
    status: "waiting" | "offered" | "booked" | "expired" | "cancelled";
    offerExpiresAt: string | null;
};
export type RecurringBookingRequest = {
    eventId: string;
    startsAt: string;
    timezone: string;
    count: number;
    interval: "weekly" | "fortnightly" | "monthly";
    idempotencyKey: string;
};
export type BalanceKind = "package" | "gift_card" | "loyalty";
export type CustomerBalance = {
    id: string;
    contactId: string;
    kind: BalanceKind;
    unit: string;
    balance: number;
    expiresAt: string | null;
};
export type BalanceAdjustment = {
    accountId: string;
    delta: number;
    reference: string;
    reason: string;
};
export type Membership = {
    id: string;
    contactId: string;
    status: "pending" | "active" | "past_due" | "cancelled";
    providerSubscriptionId: string | null;
};
export type JourneyTrigger = "booking_confirmed" | "booking_cancelled" | "document_completed" | "payment_received";
export type BookingWidget = {
    host: string;
    event: string | null;
    mode: "inline" | "popup";
    accentColor: string;
};
export type MiniSite = {
    slug: string;
    published: boolean;
    headline: string;
    bookingLinks: BookingLink[];
};
export type VideoAccess = {
    appointmentId: string;
    provider: "daily";
    joinUrl: string;
    token: string;
    expiresAt: string;
};
export type SupplierStatus = {
    provider: string;
    state: LaunchState;
    catalogSyncedAt: string | null;
    orderSubmissionEnabled: boolean;
};
export type BusinessAnalytics = {
    generatedAt: string;
    activeSubscriptions: number;
    mrrCents: number | null;
    arrCents: number | null;
    currency: string | null;
    revenueSource: "stripe_reconciled" | "unavailable";
};

/** Wire contract: POST /api/growth/checkout. Prices are always resolved server-side. */
export type GrowthCheckoutRequest = {
  offerId: string;
  idempotencyKey: string;
  name: string;
  email: string;
  recipientEmail?: string;
  coupon?: string;
  captcha?: string;
};
export type GrowthCheckoutResponse = { url: string; orderId: string };
export type GrowthOfferKind = "package" | "membership" | "gift_card";
/** Public GET /api/growth/offers?host= uses database-style field names. */
export type PublicGrowthOffer = {
  id: string;
  kind: GrowthOfferKind;
  title: string;
  description: string;
  price_cents: number;
  credit_units: number;
  unit: string;
};
export type PublicGrowthOffersResponse = {
  offers: PublicGrowthOffer[];
  checkoutEnabled: boolean;
};
/** Credit admission is owner-only; public enrollment requires booking protection. */
export type ClassEnrollmentRequest = {
  action: "enroll";
  sessionId: string;
  idempotencyKey: string;
  name: string;
  email: string;
  captcha?: string;
  applyCredits?: boolean;
  contactId?: string;
  balanceAccountId?: string;
};
export type ClassCancellationRequest = { action: "cancel"; token: string };
export type GiftCardRedemptionRequest = { code: string; name: string; email: string };
export type GiftCardRedemptionResponse = { redeemed: true; duplicate: boolean };

export type ExternalCalendarReference={provider:"google"|"microsoft";accountId:string;eventId:string};
export type ExternalCalendarMetadataUpdate={title:string;location:string;version:string;confirmNotifications?:boolean};
export type ExternalCalendarMetadataRequest=ExternalCalendarReference & ({action:"read"}|({action:"update"} & ExternalCalendarMetadataUpdate));
export type ExternalCalendarMetadataSnapshot=ExternalCalendarReference & {
 title:string;location:string;
 start:{dateTime?:string;date?:string;timeZone?:string}|null;
 end:{dateTime?:string;date?:string;timeZone?:string}|null;
 version:string|null;attendeeCount:number;requiresNotificationConfirmation:boolean;
 editableFields:("title"|"location")[];readOnly:boolean;blockedReason:string|null;unchanged?:boolean;
};
