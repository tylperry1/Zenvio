import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import {
  body,
  sameOrigin,
  failure,
  uuid,
  string,
  ApiError,
} from "@/lib/server";
import { optionSchema } from "@/lib/personalization";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await adminSession("marketplace");
    const products = (
      await getPool().query(
        "SELECT id,title,personalization_options,artwork_allowed FROM private.marketplace_products ORDER BY title",
      )
    ).rows;
    const submissions = (
      await getPool().query(
        "SELECT * FROM private.supplier_submissions ORDER BY created_at DESC LIMIT 100",
      )
    ).rows;
    return Response.json(
      { products, submissions },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token } = await adminSession("marketplace"),
      v = await body(req),
      db = await getPool().connect();
    try {
      await db.query("BEGIN");
      if (v.action === "options") {
        const options = optionSchema(v.options),
          r = await db.query(
            "UPDATE private.marketplace_products SET personalization_options=$2,artwork_allowed=$3,revision=revision+1 WHERE id=$1 RETURNING id",
            [uuid(v.id), JSON.stringify(options), v.artwork_allowed === true],
          );
        if (!r.rowCount) throw new ApiError("Product not found.", 404);
      } else if (v.action === "fulfillment") {
        if (
          ![
            "manual_pending",
            "submitted_manually",
            "exception",
            "fulfilled",
          ].includes(String(v.status))
        )
          throw new ApiError("Choose a fulfillment status.");
        const order = (
          await db.query(
            "SELECT payment_status FROM private.marketplace_orders WHERE id=$1 FOR UPDATE",
            [uuid(v.id)],
          )
        ).rows[0];
        if (!order || order.payment_status !== "paid")
          throw new ApiError("Only paid orders can enter fulfillment.", 409);
        const supplier = v.supplier_id ? uuid(v.supplier_id) : null;
        if (
          supplier &&
          !(
            await db.query(
              "SELECT 1 FROM private.marketplace_suppliers WHERE id=$1",
              [supplier],
            )
          ).rowCount
        )
          throw new ApiError("Supplier not found.", 404);
        await db.query(
          "INSERT INTO private.supplier_submissions(order_id,supplier_id,status,note,reference,actor_id) VALUES($1,$2,$3,$4,$5,$6)",
          [
            v.id,
            supplier,
            v.status,
            string(v.note || "", "fulfillment note", 2000, 0),
            string(v.reference || "", "supplier reference", 200, 0),
            token,
          ],
        );
        await db.query(
          "INSERT INTO private.marketplace_order_activity(order_id,actor_id,action,note) VALUES($1,$2,$3,$4)",
          [
            v.id,
            token,
            "supplier_" + v.status,
            string(v.note || "", "note", 2000, 0),
          ],
        );
      } else throw new ApiError("Invalid action.");
      await db.query(
        "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
        [token, "marketplace_" + v.action, JSON.stringify({ id: v.id })],
      );
      await db.query("COMMIT");
      return Response.json({ ok: true });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    return failure(e);
  }
}
