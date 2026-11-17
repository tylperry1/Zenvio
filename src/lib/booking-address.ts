import type { PoolClient } from "pg";
import {
  addressHasStreet,
  isLocationMode,
  locationLabel,
  parseAddressInput,
  toDbAddress,
  type LocationMode,
  type StructuredAddress,
} from "./addresses";
import { ApiError } from "./server";

export type BookingLocationInput = {
  locationMode?: unknown;
  serviceAddress?: unknown;
  accessInstructions?: unknown;
  saveAsResidential?: unknown;
};

export function resolveBookingLocation(input: {
  event: {
    location: string;
    location_mode?: string;
    allowed_location_modes?: string[] | null;
    virtual_instructions?: string;
  };
  businessAddress?: StructuredAddress | null;
  guest: BookingLocationInput;
}): {
  locationMode: LocationMode;
  locationText: string;
  serviceAddress: StructuredAddress | null;
  accessInstructions: string;
} {
  const allowed = (
    Array.isArray(input.event.allowed_location_modes) && input.event.allowed_location_modes.length
      ? input.event.allowed_location_modes
      : [input.event.location_mode || "custom"]
  ).filter(isLocationMode) as LocationMode[];
  const requested = isLocationMode(input.guest.locationMode)
    ? input.guest.locationMode
    : (input.event.location_mode as LocationMode) || allowed[0] || "custom";
  if (!allowed.includes(requested))
    throw new ApiError("That meeting location option is not available for this appointment type.");
  const guestAccessInstructions = String(input.guest.accessInstructions || "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .trim()
    .slice(0, 1000);
  if (requested === "virtual") {
    // Guest service-address notes must not replace host virtual join details.
    // bookings.access_instructions is capped at 1000; event virtual_instructions may be longer in the editor.
    const instructions = String(input.event.virtual_instructions || "")
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .trim()
      .slice(0, 1000);
    return {
      locationMode: "virtual",
      locationText: (input.event.location || "Virtual meeting").slice(0, 500),
      serviceAddress: null,
      accessInstructions: instructions,
    };
  }
  if (requested === "at_business") {
    const business = input.businessAddress;
    const text =
      business?.formatted ||
      input.event.location ||
      locationLabel("at_business");
    // Guest notes from customer-location UI must not overwrite business entry instructions.
    const entry = String(business?.accessInstructions || "")
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .trim()
      .slice(0, 1000);
    return {
      locationMode: "at_business",
      locationText: text.slice(0, 500),
      // Snapshot the public address on the appointment; entry instructions stay on the booking row only.
      serviceAddress: business
        ? { ...business, accessInstructions: "" }
        : null,
      accessInstructions: entry,
    };
  }
  const serviceAddress = parseAddressInput(input.guest.serviceAddress);
  if (requested === "at_customer" || requested === "custom") {
    if (!addressHasStreet(serviceAddress) && requested === "at_customer")
      throw new ApiError("Enter the service address for this appointment.");
    if (requested === "custom" && !serviceAddress.formatted && !input.event.location)
      throw new ApiError("Enter the meeting location details.");
    const locationText =
      serviceAddress.formatted ||
      input.event.location ||
      locationLabel(requested);
    const accessInstructions =
      guestAccessInstructions ||
      String(serviceAddress.accessInstructions || "")
        .replace(/[\x00-\x1f\x7f]/g, " ")
        .trim()
        .slice(0, 1000);
    return {
      locationMode: requested,
      locationText: locationText.slice(0, 500),
      serviceAddress: addressHasStreet(serviceAddress)
        ? { ...serviceAddress, accessInstructions }
        : null,
      accessInstructions,
    };
  }
  return {
    locationMode: "custom",
    locationText: input.event.location,
    serviceAddress: null,
    accessInstructions: guestAccessInstructions,
  };
}

/** Persist appointment snapshot and optionally a saved customer address without overwriting residential unless asked. */
export async function persistBookingAddress(
  db: PoolClient,
  input: {
    workspaceId: string;
    bookingId: string;
    contactId?: string | null;
    guestEmail: string;
    guestPhone: string;
    locationMode: LocationMode;
    locationText: string;
    serviceAddress: StructuredAddress | null;
    accessInstructions: string;
    saveAsResidential?: boolean;
  },
) {
  await db.query(
    `UPDATE public.bookings
        SET location=$3,
            location_mode=$4,
            service_address=$5::jsonb,
            access_instructions=$6,
            guest_phone=CASE WHEN $7<>'' THEN $7 ELSE guest_phone END
      WHERE id=$1 AND user_id=$2`,
    [
      input.bookingId,
      input.workspaceId,
      input.locationText.slice(0, 500),
      input.locationMode,
      input.serviceAddress ? JSON.stringify(input.serviceAddress) : null,
      input.accessInstructions,
      input.guestPhone,
    ],
  );

  let contactId = input.contactId || null;
  if (!contactId) {
    contactId = (
      await db.query(
        "SELECT id FROM public.contacts WHERE user_id=$1 AND email=lower(trim($2))",
        [input.workspaceId, input.guestEmail],
      )
    ).rows[0]?.id || null;
  }
  if (!contactId) return;

  // Public guests are not authenticated for that contact. Only fill blank phone; never overwrite.
  if (input.guestPhone) {
    await db.query(
      `UPDATE public.contacts
          SET phone=$2
        WHERE id=$1 AND user_id=$3 AND phone=''`,
      [contactId, input.guestPhone, input.workspaceId],
    );
  }

  if (!input.serviceAddress || !addressHasStreet(input.serviceAddress)) return;

  // Appointment-scoped reuse only. Do not mutate residential/billing from an unauthenticated booking.
  const row = toDbAddress(input.serviceAddress);
  await db.query(
    `INSERT INTO private.addresses(
       workspace_id, contact_id, address_type, street, street2, city, state, postal_code,
       country, formatted, access_instructions, validated, smarty_key, source
     ) VALUES ($1,$2,'service_saved',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      input.workspaceId,
      contactId,
      row.street,
      row.street2,
      row.city,
      row.state,
      row.postal_code,
      row.country,
      row.formatted,
      row.access_instructions,
      row.validated,
      row.smarty_key,
      row.source,
    ],
  );
  void input.saveAsResidential;
}

export async function businessAddressForWorkspace(db: PoolClient, workspaceId: string) {
  const row = (
    await db.query(
      `SELECT street, street2, city, state, postal_code, country, formatted, access_instructions,
              validated, smarty_key, source
         FROM private.addresses
        WHERE workspace_id=$1 AND address_type='business'
        ORDER BY updated_at DESC LIMIT 1`,
      [workspaceId],
    )
  ).rows[0];
  return row
    ? parseAddressInput({
        street: row.street,
        street2: row.street2,
        city: row.city,
        state: row.state,
        postalCode: row.postal_code,
        country: row.country,
        formatted: row.formatted,
        accessInstructions: row.access_instructions,
        validated: row.validated,
        smartyKey: row.smarty_key,
        source: row.source,
      })
    : null;
}
