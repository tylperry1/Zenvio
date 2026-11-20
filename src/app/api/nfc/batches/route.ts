import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { cleanDestinationUrl } from "@/lib/nfc-studio";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { token: owner } = await session();
    const db = getPool();
    const batches = (
      await db.query(`SELECT * FROM private.nfc_batches WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [owner])
    ).rows;
    const ids = batches.map((b) => b.id);
    const items = ids.length
      ? (
          await db.query(
            `SELECT * FROM private.nfc_batch_items WHERE batch_id=ANY($1::uuid[]) ORDER BY completed_at DESC NULLS LAST`,
            [ids],
          )
        ).rows
      : [];
    return Response.json({ batches, items });
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

    if (action === "create") {
      const name = string(input.name, "name").trim();
      if (name.length < 1 || name.length > 120) throw new ApiError("Batch name must be 1–120 characters.");
      const destinationUrl = cleanDestinationUrl(input.destinationUrl);
      if (!destinationUrl) throw new ApiError("Choose a destination URL for this batch.");
      const smartCardId = input.smartCardId ? uuid(input.smartCardId) : null;
      if (smartCardId) {
        const ok = await db.query("SELECT 1 FROM private.smart_cards WHERE id=$1 AND user_id=$2", [smartCardId, owner]);
        if (!ok.rowCount) throw new ApiError("Smart Card not found.", 404);
      }
      const { rows } = await db.query(
        `INSERT INTO private.nfc_batches(user_id,smart_card_id,name,destination_url,status)
         VALUES($1,$2,$3,$4,'open') RETURNING *`,
        [owner, smartCardId, name, destinationUrl],
      );
      return Response.json({ batch: rows[0] }, { status: 201 });
    }

    if (action === "record-item") {
      const batchId = uuid(input.batchId);
      const itemStatus = string(input.status, "status");
      if (!["succeeded", "failed", "skipped"].includes(itemStatus)) throw new ApiError("Invalid item status.");
      const tagId = input.tagId ? uuid(input.tagId) : null;
      const operationId = input.operationId ? uuid(input.operationId) : null;
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const batch = (
          await client.query(`SELECT * FROM private.nfc_batches WHERE id=$1 AND user_id=$2 FOR UPDATE`, [batchId, owner])
        ).rows[0];
        if (!batch) throw new ApiError("Batch not found.", 404);
        if (batch.status !== "open") throw new ApiError("This batch is closed.");
        const { rows } = await client.query(
          `INSERT INTO private.nfc_batch_items(batch_id,tag_id,operation_id,status,error_code,completed_at)
           VALUES($1,$2,$3,$4,$5,now()) RETURNING *`,
          [batchId, tagId, operationId, itemStatus, string(input.errorCode || "", "errorCode", 80, 0)],
        );
        const updated = (
          await client.query(
            `UPDATE private.nfc_batches SET
               total_tags=total_tags+1,
               successful_tags=successful_tags+CASE WHEN $2='succeeded' THEN 1 ELSE 0 END,
               failed_tags=failed_tags+CASE WHEN $2='failed' THEN 1 ELSE 0 END
             WHERE id=$1 AND user_id=$3 RETURNING *`,
            [batchId, itemStatus, owner],
          )
        ).rows[0];
        await client.query("COMMIT");
        return Response.json({ item: rows[0], batch: updated });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }

    if (action === "complete" || action === "cancel") {
      const batchId = uuid(input.batchId);
      const status = action === "complete" ? "completed" : "cancelled";
      const { rows } = await db.query(
        `UPDATE private.nfc_batches SET status=$3, completed_at=now()
         WHERE id=$1 AND user_id=$2 AND status='open' RETURNING *`,
        [batchId, owner, status],
      );
      if (!rows[0]) throw new ApiError("Open batch not found.", 404);
      return Response.json({ batch: rows[0] });
    }

    throw new ApiError("Unknown batch action.");
  } catch (e) {
    return failure(e);
  }
}
