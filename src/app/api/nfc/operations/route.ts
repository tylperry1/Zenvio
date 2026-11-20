import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { payloadHash, summarizeRecords } from "@/lib/nfc-studio";

export const dynamic = "force-dynamic";

const OP_TYPES = new Set(["read", "write", "verify", "program_smart_card", "lock", "batch_item"]);
const PLATFORMS = new Set(["ios-native", "android-native", "web-nfc", "none"]);
const STATUSES = new Set(["started", "succeeded", "failed", "cancelled", "unverified"]);
const VERIFY = new Set(["not_requested", "matched", "mismatched", "unavailable"]);

export async function GET(request: NextRequest) {
  try {
    const { token: owner } = await session();
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 50)));
    const { rows } = await getPool().query(
      `SELECT * FROM private.nfc_operations WHERE user_id=$1 ORDER BY started_at DESC LIMIT $2`,
      [owner, limit],
    );
    return Response.json({ operations: rows });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token: owner } = await session();
    const input = await body(request);
    const operationType = string(input.operationType, "operationType");
    if (!OP_TYPES.has(operationType)) throw new ApiError("Unknown operation type.");
    const platform = string(input.platform || "none", "platform", 40, 1);
    if (!PLATFORMS.has(platform)) throw new ApiError("Unknown platform.");
    const status = string(input.status || "started", "status", 40, 1);
    if (!STATUSES.has(status)) throw new ApiError("Unknown status.");
    const verificationStatus = string(input.verificationStatus || "not_requested", "verificationStatus", 40, 1);
    if (!VERIFY.has(verificationStatus)) throw new ApiError("Unknown verification status.");
    const tagId = input.tagId ? uuid(input.tagId) : null;
    if (tagId) {
      const ok = await getPool().query("SELECT 1 FROM private.nfc_tags WHERE id=$1 AND user_id=$2", [tagId, owner]);
      if (!ok.rowCount) throw new ApiError("Tag not found.", 404);
    }
    const records = Array.isArray(input.records) ? input.records : [];
    const summary =
      typeof input.payloadSummary === "string" && input.payloadSummary
        ? input.payloadSummary.slice(0, 500)
        : summarizeRecords(records.map((r: { type?: string; value?: string }) => ({ type: String(r.type || ""), value: String(r.value || "") })));
    const { rows } = await getPool().query(
      `INSERT INTO private.nfc_operations(
         tag_id,user_id,operation_type,platform,device_type,status,payload_type,payload_summary,payload_hash,
         verification_status,error_code,error_message,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $6='started' THEN NULL ELSE now() END)
       RETURNING *`,
      [
        tagId,
        owner,
        operationType,
        platform,
        string(input.deviceType || "", "deviceType", 80, 0),
        status,
        string(input.payloadType || "", "payloadType", 80, 0),
        summary,
        payloadHash(summary),
        verificationStatus,
        string(input.errorCode || "", "errorCode", 80, 0),
        string(input.errorMessage || "", "errorMessage", 500, 0),
      ],
    );
    if (tagId && operationType === "read" && status === "succeeded") {
      await getPool().query("UPDATE private.nfc_tags SET last_scanned_at=now(), updated_at=now() WHERE id=$1 AND user_id=$2", [
        tagId,
        owner,
      ]);
    }
    return Response.json({ operation: rows[0] }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
