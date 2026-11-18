/**
 * Customer-facing copy for product status and recoverable errors.
 * Keep operational diagnostics in admin tools and server logs.
 * Do not put provider setup, credential, or launch-gate details in these strings.
 */

export const customerMessages = {
  billing: {
    enrollmentPaused:
      "Online plan enrollment isn’t open right now. Your current plan and access stay the same.",
    enrollmentPausedWithBillingAccount:
      "Online plan enrollment isn’t open right now. You can still manage payment methods and invoices for an existing billing account.",
    enrollmentPausedTeamMember:
      "Your plan and seat are managed by your team. Ask your team owner if you have billing questions.",
    billingUnavailable:
      "Billing management isn’t available for this workspace right now. Your current access is unchanged.",
    syncSuccessFallback: "Subscription status refreshed.",
    syncButton: "Refresh subscription status",
    invoicesEmptyFree: "Free workspaces have no recurring bill.",
    invoicesLoadPrompt: "Load your latest invoices from your billing account.",
    invoicesFromProvider: "See your invoice for the exact amount",
    paidSubscriptionDetail: "Paid subscription",
    platformIncluded:
      "Teams access is included with this account, with unlimited teammates. No paid seat upgrade is required.",
    teamPlanManaged:
      "Your team manages this plan. Your seat is included in the team subscription.",
    teamSeatManaged: "Your seat is managed by your team.",
    checkoutPreparing: "Online enrollment isn’t open right now. Your current access is unchanged.",
    checkoutUnavailable:
      "Online checkout isn’t available right now. No payment has been taken.",
    enrollPreparing: "Online enrollment isn’t open right now. No payment has been taken.",
    enrollPricingUnavailable:
      "This plan isn’t ready for enrollment yet. No payment has been taken.",
    noBillingAccount:
      "No billing account yet. Your Free plan doesn’t need a payment method.",
  },
  auth: {
    resetEmailUnavailable:
      "We couldn’t send a password reset email right now. Please try again later or contact support.",
    signupPaused:
      "New public signups aren’t open right now. Existing members can still sign in; invited users should use their invitation link.",
  },
  payments: {
    appointmentUnavailable:
      "Appointment payments aren’t available right now. No payment has been taken.",
    connectUnavailable:
      "Payment setup isn’t available right now. Please try again later or contact support.",
  },
  integrations: {
    calendarUnavailable:
      "Google Calendar isn’t available to connect right now. Please try again later or contact support.",
    calendarSetupRequired:
      "Google Calendar isn’t ready to connect yet. Please try again later or contact support.",
    emailUnavailable: "Email delivery is temporarily unavailable. Please try again later.",
    designStorageUnavailable:
      "We couldn’t save design changes right now. Your existing profile is unchanged.",
  },
  assistant: {
    notReadyTitle: "The assistant isn’t available yet",
    notReadyBody:
      "We’re finishing setup for Zenvio Assistant. Please check back soon, or contact support if you need help now.",
  },
  notifications: {
    pageDescription:
      "Control browser alerts on this device. Email and SMS for bookings are managed separately under Automations and your services.",
    browserBlurb:
      "Asks this browser for permission so Zenvio can show alerts while the app is open on this device.",
    emailSmsBlurb:
      "Booking confirmations, reminders, and follow-ups are sent by email and SMS through Automations and your service settings. Those channels are separate from this browser permission.",
    emailSmsNote:
      "Security, billing, and account emails always send. Marketing email stays opt-in. Phone alerts use your Automations and messaging settings—not this browser switch.",
  },
  commerce: {
    purchasesPausedOwner:
      "Online purchases aren’t open right now. You can still prepare offers and preview your storefront.",
    purchasesPausedCustomer:
      "Online purchases aren’t available right now. Contact the business for help.",
  },
  video: {
    unavailable:
      "Built-in video meetings aren’t available yet. Add a meeting link as the appointment location instead.",
  },
  generic: {
    tryAgain: "We couldn’t complete that request. Please try again.",
    loadFailed: "We couldn’t load this information right now. Please try again.",
    paymentFailed: "We couldn’t complete your payment. Please try again or contact support.",
  },
} as const;
