import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { assertTagStatus, cleanDestinationUrl, cleanNotes, cleanTagLabel } from "@/lib/nfc-studio";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { token: owner } = await session();
    const { rows } = await getPool().query(
      `SELECT t.*, c.token AS smart_card_token, c.label AS smart_card_label
         FROM private.nfc_tags t
         LEFT JOIN private.smart_cards c ON c.id=t.smart_card_id AND c.user_id=t.user_id
        WHERE t.user_id=$1 ORDER BY t.updated_at DESC LIMIT 200`,
      [owner],
    );
    return Response.json({ tags: rows });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token: owner } = await session();
    const input = await body(request);
    const action = string(input.action, "action");
    const db = getPool();

    if (action === "register") {
      const label = cleanTagLabel(input.label) || "NFC tag";
      const destinationUrl = cleanDestinationUrl(input.destinationUrl);
      const notes = cleanNotes(input.notes);
      const smartCardId = input.smartCardId ? uuid(input.smartCardId) : null;
      if (smartCardId) {
        const ok = await db.query("SELECT 1 FROM private.smart_cards WHERE id=$1 AND user_id=$2", [smartCardId, owner]);
        if (!ok.rowCount) throw new ApiError("Smart Card not found.", 404);
      }
      const hardware =
        typeof input.hardwareIdentifier === "string" && input.hardwareIdentifier.trim()
          ? input.hardwareIdentifier.trim().slice(0, 120)
          : null;
      const { rows } = await db.query(
        `INSERT INTO private.nfc_tags(user_id,smart_card_id,label,tag_type,technology,capacity_bytes,status,destination_url,hardware_identifier,notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          owner,
          smartCardId,
          label,
          string(input.tagType || "", "tagType", 80, 0),
          string(input.technology || "", "technology", 80, 0),
          typeof input.capacityBytes === "number" ? input.capacityBytes : null,
          smartCardId ? "assigned" : "registered",
          destinationUrl,
          hardware,
          notes,
        ],
      );
      await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'nfc_tag_registered',$2)", [
        owner,
        JSON.stringify({ tagId: rows[0].id }),
      ]);
      return Response.json({ tag: rows[0] }, { status: 201 });
    }

    if (action === "update") {
      const id = uuid(input.id);
      const label = cleanTagLabel(input.label);
      const notes = cleanNotes(input.notes);
      const status = input.status !== undefined ? assertTagStatus(input.status) : null;
      const destinationUrl = input.destinationUrl !== undefined ? cleanDestinationUrl(input.destinationUrl) : null;
      let smartCardId: string | null | undefined = undefined;
      if (input.smartCardId === null) smartCardId = null;
      else if (input.smartCardId) {
        smartCardId = uuid(input.smartCardId);
        const ok = await db.query("SELECT 1 FROM private.smart_cards WHERE id=$1 AND user_id=$2", [smartCardId, owner]);
        if (!ok.rowCount) throw new ApiError("Smart Card not found.", 404);
      }
      const { rows } = await db.query(
        `UPDATE private.nfc_tags SET
           label=COALESCE(NULLIF($3,''),label),
           notes=COALESCE($4,notes),
           status=COALESCE($5,status),
           destination_url=COALESCE($6,destination_url),
           smart_card_id=CASE WHEN $7::boolean THEN $8::uuid ELSE smart_card_id END,
           updated_at=now()
         WHERE id=$1 AND user_id=$2 RETURNING *`,
        [id, owner, label, notes, status, destinationUrl, smartCardId !== undefined, smartCardId ?? null],
      );
      if (!rows[0]) throw new ApiError("Tag not found.", 404);
      return Response.json({ tag: rows[0] });
    }

    if (action === "record-program") {
      const id = input.id ? uuid(input.id) : null;
      const destinationUrl = cleanDestinationUrl(input.destinationUrl);
      if (!destinationUrl) throw new ApiError("Destination URL is required after programming.");
      const verified = Boolean(input.verified);
      const status = verified ? (input.smartCardId ? "assigned" : "programmed") : "failed";
      const smartCardId = input.smartCardId ? uuid(input.smartCardId) : null;
      if (smartCardId) {
        const ok = await db.query("SELECT 1 FROM private.smart_cards WHERE id=$1 AND user_id=$2", [smartCardId, owner]);
        if (!ok.rowCount) throw new ApiError("Smart Card not found.", 404);
      }
      let tag;
      if (id) {
        const { rows } = await db.query(
          `UPDATE private.nfc_tags SET destination_url=$3, status=$4, smart_card_id=COALESCE($5,smart_card_id),
             last_programmed_at=now(), updated_at=now(),
             tag_type=COALESCE(NULLIF($6,''),tag_type), technology=COALESCE(NULLIF($7,''),technology),
             capacity_bytes=COALESCE($8,capacity_bytes)
           WHERE id=$1 AND user_id=$2 RETURNING *`,
          [
            id,
            owner,
            destinationUrl,
            status,
            smartCardId,
            string(input.tagType || "", "tagType", 80, 0),
            string(input.technology || "", "technology", 80, 0),
            typeof input.capacityBytes === "number" ? input.capacityBytes : null,
          ],
        );
        tag = rows[0];
        if (!tag) throw new ApiError("Tag not found.", 404);
      } else {
        const { rows } = await db.query(
          `INSERT INTO private.nfc_tags(user_id,smart_card_id,label,tag_type,technology,capacity_bytes,status,destination_url,last_programmed_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING *`,
          [
            owner,
            smartCardId,
            cleanTagLabel(input.label) || "Programmed tag",
            string(input.tagType || "", "tagType", 80, 0),
            string(input.technology || "", "technology", 80, 0),
            typeof input.capacityBytes === "number" ? input.capacityBytes : null,
            status,
            destinationUrl,
          ],
        );
        tag = rows[0];
      }
      return Response.json({ tag });
    }

    throw new ApiError("Unknown NFC tag action.");
  } catch (e) {
    return failure(e);
  }
}
