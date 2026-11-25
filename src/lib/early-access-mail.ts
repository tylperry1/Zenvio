import type { PoolClient } from "pg";
import { queueDelivery, appOrigin } from "./lifecycle";
export function reservationMessage(name: string) {
  return `${name},\n\nYou're on Zenvio's early-access list. We'll use this email address when enrollment opens.\n\nThe published catalog prices apply when you enroll. No discount or promotion is attached to this reservation. Use this same email address when enrolling at launch.\n\nNo account or paid subscription has been created. No payment has been taken, and you won't be charged automatically for joining this list. We'll let you know when enrollment opens; no launch date is promised.\n\nExplore the demo: ${appOrigin()}/demo\nPackage details: ${appOrigin()}/pricing\n\nQuestions, removal requests, or didn't request this reservation? Contact hello@gozenvio.com.\n\nThe Zenvio team`;
}
export async function queueReservationConfirmation(db: PoolClient, signup: {id:string;name:string;email:string}) {
  await queueDelivery(db, {
    user: null,
    earlyAccess: signup.id,
    kind: "early_access_confirmation",
    key: "early-access-confirmation:" + signup.id,
    to: signup.email,
    subject: "You're on the Zenvio early-access list",
    text: reservationMessage(signup.name),
  });
}
