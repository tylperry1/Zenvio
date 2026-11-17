import { getPool } from "../db";
import { ApiError } from "../server";
import { settleUsage } from "../launch/provider-policy";

/** Reserve and settle a Smarty lookup against platform monthly budget. */
export async function recordSmartyUsage(input: {
  workspaceId: string;
  micros: number;
  operation: "autocomplete" | "validate" | "health";
  platformCap: number;
}) {
  if (!Number.isSafeInteger(input.micros) || input.micros < 0)
    throw new ApiError("Invalid Smarty usage amount.", 503);
  if (input.micros === 0) return null;
  if (!input.workspaceId) throw new ApiError("Missing workspace for Smarty usage.", 503);
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["provider-spend:smarty"]);
    const owner = (
      await db.query(
        "SELECT owner_id FROM private.team_entitlement_roots($1) ORDER BY owner_id LIMIT 1",
        [input.workspaceId],
      )
    ).rows[0]?.owner_id || input.workspaceId;
    const { rows } = await db.query(
      `SELECT coalesce(sum(case when state='settled' then actual_micros else reserved_micros end),0)::text total
         FROM private.provider_usage_reservations
        WHERE provider='smarty' AND state<>'released' AND created_at>=date_trunc('month',now())`,
    );
    if (Number(rows[0].total) + input.micros > input.platformCap)
      throw new ApiError("Smarty monthly usage limit reached.", 429);
    const inserted = await db.query(
      `INSERT INTO private.provider_usage_reservations(user_id,provider,model,reserved_micros,units)
       VALUES($1,'smarty',$2,$3,1) RETURNING id`,
      [owner, input.operation, input.micros],
    );
    await db.query("COMMIT");
    const id = inserted.rows[0].id as string;
    await settleUsage(id, { micros: input.micros, units: 1 });
    return id;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}

export async function smartyUsageSummary() {
  const { rows } = await getPool().query(
    `SELECT
        count(*)::int AS lookups,
        coalesce(sum(case when state='settled' then actual_micros else reserved_micros end),0)::text AS micros,
        coalesce(sum(case when model='autocomplete' then 1 else 0 end),0)::int AS autocomplete,
        coalesce(sum(case when model='validate' then 1 else 0 end),0)::int AS validations
       FROM private.provider_usage_reservations
      WHERE provider='smarty' AND state<>'released' AND created_at>=date_trunc('month',now())`,
  );
  return {
    monthLookups: rows[0]?.lookups || 0,
    monthMicros: Number(rows[0]?.micros || 0),
    autocomplete: rows[0]?.autocomplete || 0,
    validations: rows[0]?.validations || 0,
  };
}
