import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { integrationValue } from "@/lib/platform-settings";
import { ApiError, body, failure, sameOrigin, string, uuid } from "@/lib/server";
import { normalizeE164 } from "@/lib/twilio";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
    try {
        sameOrigin(request);
        const { token } = await adminSession(), input = await body(request), userId = uuid(input.userId), sender = normalizeE164(string(input.senderNumber, "sender", 20)), profile = uuid(input.messagingProfileId), reference = string(input.registrationReference, "carrier approval reference", 200, 8), reason = string(input.reason, "reason", 500, 8);
        if (input.confirmation !== "CARRIER_APPROVAL_VERIFIED")
            throw new ApiError("Confirm approved carrier registration before enabling SMS.", 409);
        const key = await integrationValue("TELNYX_API_KEY");
        if (!key)
            throw new ApiError("Telnyx requires configuration.", 503);
        const response = await fetch("https://api.telnyx.com/v2/phone_numbers?" + new URLSearchParams({ "filter[phone_number]": sender }), { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) }), numbers = await response.json();
        const number = numbers.data?.find((n: any) => n.phone_number === sender);
        if (!response.ok || !number?.id || number.status !== "active")
            throw new ApiError("The sender could not be verified as active in this Telnyx account.", 409);
        const messaging = await fetch(`https://api.telnyx.com/v2/phone_numbers/${encodeURIComponent(number.id)}/messaging`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) }), details = await messaging.json();
        if (!messaging.ok || details.data?.messaging_profile_id !== profile)
            throw new ApiError("The sender does not match the approved messaging profile.", 409);
        const country = string(input.countryCode, "country", 2, 2).toUpperCase();
        if (!/^[A-Z]{2}$/.test(country) || typeof input.enabled !== "boolean")
            throw new ApiError("Invalid SMS activation configuration.");
        const db = await getPool().connect();
        try {
            await db.query("begin");
            await db.query(`insert into private.sms_provider_connections(user_id,provider,sender_number,registration_state,messaging_enabled,country_code,messaging_profile_id,registration_verified_at,registration_reference)
  values($1,'telnyx',$2,'approved',$3,$4,$5,now(),$6) on conflict(user_id) do update set provider='telnyx',sender_number=$2,registration_state='approved',messaging_enabled=$3,country_code=$4,messaging_profile_id=$5,registration_verified_at=now(),registration_reference=$6,updated_at=now()`, [userId, sender, input.enabled, country, profile, reference]);
            await db.query("insert into private.operation_log(actor_id,action,details) values($1,'telnyx_sender_verified',$2)", [token, JSON.stringify({ userId, sender, profile, registrationReference: reference, reason, carrierApproval: "operator_attestation", numberVerifiedByProvider: true })]);
            await db.query("commit");
            return Response.json({ ok: true, numberVerified: true, carrierApproval: "operator_attestation", enabled: input.enabled });
        }
        catch (e) {
            await db.query("rollback");
            throw e;
        }
        finally {
            db.release();
        }
    }
    catch (e) {
        return failure(e);
    }
}
