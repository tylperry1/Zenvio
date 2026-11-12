// Booking mail uses an address on the configured sender's verified domain.
const bookingKinds = new Set([
  "booking_confirmation", "booking_reminder", "booking_changed",
  "booking_cancelled", "class_confirmation", "class_cancellation",
]);
function address(value: string) {
  const match = value.trim().match(/^(?:[^<>\r\n]+<)?([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+)@([A-Z0-9.-]+\.[A-Z]{2,})>?$/i);
  return match ? { mailbox: match[1], domain: match[2].toLowerCase() } : null;
}
export function deliverySender(kind: string, verifiedFrom: string, bookingFrom = "") {
  const fallback = verifiedFrom.trim();
  if (!bookingKinds.has(kind)) return fallback;
  const verified = address(fallback);
  if (!verified || verified.domain === "resend.dev") return fallback;
  const custom = address(bookingFrom);
  if (custom && custom.domain === verified.domain) return bookingFrom.trim();
  return `Zenvio Bookings <bookings@${verified.domain}>`;
}
