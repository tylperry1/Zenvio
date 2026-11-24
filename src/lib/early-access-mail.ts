import type { PoolClient } from "pg";
import { queueDelivery, appOrigin } from "./lifecycle";
export function reservationMessage(name: string) {
  return `${name},\n\nYou're on Zenvio's early-access list. Your early-adopter offer is reserved for this email address.\n\nYour launch offer: 50% off your first 3 monthly subscription payments on an eligible paid plan.\n\nThe discounted amount is calculated from the published plan price when you enroll. Additional seats and add-ons are not discounted, and overage usage, taxes, and payment processing fees are excluded. Use this same email address when enrolling at launch.\n\nNo account or paid subscription has been created. No payment has been taken, and you won't be charged automatically for joining this list. We'll let you know when enrollment opens; no launch date is promised.\n\nExplore the demo: ${appOrigin()}/demo\nPackage details: ${appOrigin()}/pricing\n\nQuestions, removal requests, or didn't request this reservation? Contact hello@gozenvio.com.\n\nThe Zenvio team`;
}
export async function queueReservationConfirmation(db: PoolClient, signup: {id:string;name:string;email:string}) {
  await queueDelivery(db, {
    user: null,
    earlyAccess: signup.id,
    kind: "early_access_confirmation",
    key: "early-access-confirmation:" + signup.id,
    to: signup.email,
    subject: "You're on the list — your Zenvio launch offer is reserved",
    text: reservationMessage(signup.name),
  });
}
