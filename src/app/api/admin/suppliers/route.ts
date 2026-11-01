import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { ApiError, body, email, failure, integer, sameOrigin, string, uuid } from "@/lib/server";
import {
  agreementStatuses,
  apiAvailability,
  integrationStatuses,
  isPipelineStatus,
  pipelineStatuses,
  recommendedTargets,
  scorecardCriteria,
} from "@/lib/supplier-pipeline";

export const dynamic = "force-dynamic";
const fulfillments = ["dropship", "wholesale", "print_on_demand"];
const oneOf = <T extends readonly (readonly [string, string])[]>(list: T, v: unknown, name: string) => {
  if (!list.some(([k]) => k === v)) throw new ApiError(`Choose a valid ${name}.`);
  return v as string;
};
function url(v: unknown, name: string) {
  const s = string(v ?? "", name, 500, 0).trim();
  if (s && !/^https:\/\/[^\s]+$/i.test(s)) throw new ApiError(`${name[0].toUpperCase() + name.slice(1)} must start with https://`);
  return s;
}

export async function GET() {
  try {
    await adminSession("marketplace");
    const db = getPool();
    const [suppliers, contacts, activity, families, categories, rules] = await Promise.all([
      db.query(
        `SELECT s.*,(SELECT count(*)::int FROM private.marketplace_products p WHERE p.supplier_id=s.id AND p.status='active') active_products,
                (SELECT count(*)::int FROM private.marketplace_order_items i WHERE i.supplier_id=s.id) order_items
           FROM private.marketplace_suppliers s ORDER BY s.created_at`,
      ),
      db.query("SELECT * FROM private.supplier_contacts ORDER BY created_at"),
      db.query(
        `SELECT a.id,a.supplier_id,a.kind,a.body,a.url,a.created_at,u.email actor
           FROM private.supplier_activity a LEFT JOIN public."user" u ON u.id=a.actor_id
          ORDER BY a.created_at DESC LIMIT 400`,
      ),
      db.query("SELECT * FROM private.marketplace_families ORDER BY sort"),
      db.query("SELECT * FROM private.marketplace_categories ORDER BY family,sort,name"),
      db.query("SELECT * FROM private.marketplace_pricing_rules ORDER BY scope,scope_key"),
    ]);
    return Response.json(
      {
        suppliers: suppliers.rows.map((s) => ({
          ...s,
          contacts: contacts.rows.filter((c) => c.supplier_id === s.id),
          activity: activity.rows.filter((a) => a.supplier_id === s.id).slice(0, 50),
        })),
        families: families.rows,
        categories: categories.rows,
        rules: rules.rows,
        options: { pipelineStatuses, apiAvailability, integrationStatuses, agreementStatuses, scorecardCriteria },
        missingTargets: recommendedTargets.filter((t) => !suppliers.rows.some((s) => s.name.toLowerCase() === t.name.toLowerCase())).map((t) => t.name),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await adminSession("marketplace");
    const input = await body(request);
    const db = await getPool().connect();
    const log = (supplierId: string, kind: string, text: string, link: string | null = null) =>
      db.query("INSERT INTO private.supplier_activity(supplier_id,actor_id,kind,body,url) VALUES($1,$2,$3,$4,$5)", [supplierId, token, kind, text, link]);
    try {
      await db.query("BEGIN");
      let result: Record<string, unknown> = { ok: true };

      if (input.action === "seed-targets") {
        let added = 0;
        for (const t of recommendedTargets) {
          const r = await db.query(
            `INSERT INTO private.marketplace_suppliers(name,website,fulfillment,categories,connector,active,pipeline_status)
             SELECT $1,$2,$3,$4,$5,false,'identified' WHERE NOT EXISTS(SELECT 1 FROM private.marketplace_suppliers WHERE lower(name)=lower($1)) RETURNING id`,
            [t.name, t.website, t.fulfillment, t.categories, t.connector],
          );
          if (r.rows[0]) {
            added++;
            await log(r.rows[0].id, "status", "Added as an acquisition target.");
          }
        }
        result = { ok: true, added };
      } else if (input.action === "save") {
        const fields = {
          name: string(input.name, "supplier name", 100, 2),
          website: url(input.website, "website"),
          contact_email: input.contact_email ? email(input.contact_email) : "",
          fulfillment: fulfillments.includes(String(input.fulfillment)) ? String(input.fulfillment) : (() => { throw new ApiError("Choose a fulfillment method."); })(),
          lead_time: string(input.lead_time ?? "", "production turnaround", 100, 0),
          notes: string(input.notes ?? "", "notes", 2000, 0),
          categories: Array.isArray(input.categories) ? input.categories.filter((c: unknown) => typeof c === "string" && /^[a-z][a-z-]{1,30}$/.test(c)).slice(0, 10) : [],
          application_url: url(input.application_url, "application URL"),
          api_availability: oneOf(apiAvailability, input.api_availability ?? "unknown", "API availability"),
          reseller_requirements: string(input.reseller_requirements ?? "", "reseller requirements", 2000, 0),
          monthly_fee_cents: input.monthly_fee_cents === null || input.monthly_fee_cents === "" || input.monthly_fee_cents === undefined ? null : integer(Number(input.monthly_fee_cents), "monthly fee", 0, 100000000),
          minimum_order: string(input.minimum_order ?? "", "minimum order", 300, 0),
          pricing_model: string(input.pricing_model ?? "", "pricing model", 500, 0),
          fulfillment_locations: string(input.fulfillment_locations ?? "", "fulfillment locations", 500, 0),
          shipping_regions: string(input.shipping_regions ?? "", "shipping regions", 500, 0),
          return_policy: string(input.return_policy ?? "", "return policy", 1000, 0),
          agreement_status: oneOf(agreementStatuses, input.agreement_status ?? "none", "agreement status"),
          integration_status: oneOf(integrationStatuses, input.integration_status ?? "not_started", "integration status"),
          follow_up_on: input.follow_up_on ? (/^\d{4}-\d{2}-\d{2}$/.test(String(input.follow_up_on)) ? String(input.follow_up_on) : (() => { throw new ApiError("Choose a valid follow-up date."); })()) : null,
        };
        const keys = Object.keys(fields);
        const values = Object.values(fields);
        if (input.id) {
          const id = uuid(input.id);
          const r = await db.query(
            `UPDATE private.marketplace_suppliers SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")},updated_at=now() WHERE id=$1 RETURNING id`,
            [id, ...values],
          );
          if (!r.rows[0]) throw new ApiError("Supplier not found.", 404);
          result = { ok: true, id };
        } else {
          const r = await db.query(
            `INSERT INTO private.marketplace_suppliers(${keys.join(",")},active) VALUES(${keys.map((_, i) => `$${i + 1}`).join(",")},false) RETURNING id`,
            values,
          );
          await log(r.rows[0].id, "status", "Supplier added.");
          result = { ok: true, id: r.rows[0].id };
        }
      } else if (input.action === "status") {
        const id = uuid(input.id);
        if (!isPipelineStatus(input.status)) throw new ApiError("Choose a pipeline status.");
        const before = (await db.query("SELECT pipeline_status FROM private.marketplace_suppliers WHERE id=$1 FOR UPDATE", [id])).rows[0];
        if (!before) throw new ApiError("Supplier not found.", 404);
        // Only active suppliers may be selected for products; everything else stays inactive.
        await db.query("UPDATE private.marketplace_suppliers SET pipeline_status=$2,active=($2='active'),updated_at=now() WHERE id=$1", [id, input.status]);
        const label = (s: string) => pipelineStatuses.find(([k]) => k === s)?.[1] || s;
        const note = string(input.note ?? "", "note", 1000, 0).trim();
        await log(id, "status", `${label(before.pipeline_status)} → ${label(input.status)}${note ? `: ${note}` : ""}`);
      } else if (input.action === "note") {
        const id = uuid(input.id);
        const kind = ["note", "outreach", "document", "integration"].includes(String(input.kind)) ? String(input.kind) : "note";
        const text = string(input.body, "note", 4000, 1).trim();
        const link = input.url ? url(input.url, "document link") : null;
        if (kind === "document" && !link) throw new ApiError("Add the document link.");
        const exists = await db.query("SELECT 1 FROM private.marketplace_suppliers WHERE id=$1", [id]);
        if (!exists.rowCount) throw new ApiError("Supplier not found.", 404);
        await log(id, kind, text, link || null);
      } else if (input.action === "contact") {
        const id = uuid(input.id);
        await db.query("INSERT INTO private.supplier_contacts(supplier_id,name,role,email,phone) VALUES($1,$2,$3,$4,$5)", [
          id,
          string(input.name, "contact name", 120, 1),
          string(input.role ?? "", "role", 120, 0),
          input.email ? email(input.email) : "",
          string(input.phone ?? "", "phone", 40, 0),
        ]);
      } else if (input.action === "remove-contact") {
        await db.query("DELETE FROM private.supplier_contacts WHERE id=$1", [uuid(input.contactId)]);
      } else if (input.action === "scorecard") {
        const id = uuid(input.id);
        const scores: Record<string, number> = {};
        const raw = (input.scores && typeof input.scores === "object" ? input.scores : {}) as Record<string, unknown>;
        for (const [k] of scorecardCriteria) {
          const v = raw[k];
          if (v === null || v === undefined || v === "") continue;
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > 5) throw new ApiError("Scores are whole numbers from 1 to 5.");
          scores[k] = n;
        }
        const r = await db.query("UPDATE private.marketplace_suppliers SET scorecard=$2,updated_at=now() WHERE id=$1", [id, JSON.stringify(scores)]);
        if (!r.rowCount) throw new ApiError("Supplier not found.", 404);
      } else if (input.action === "rule") {
        const scope = String(input.scope);
        if (!["global", "family", "category", "supplier"].includes(scope)) throw new ApiError("Choose a rule scope.");
        const key = scope === "global" ? "" : scope === "supplier" ? uuid(input.scope_key) : string(input.scope_key, "rule target", 100, 1);
        if (scope === "family" && !(await db.query("SELECT 1 FROM private.marketplace_families WHERE slug=$1", [key])).rowCount) throw new ApiError("Unknown product family.");
        if (scope === "category" && !(await db.query("SELECT 1 FROM private.marketplace_categories WHERE name=$1", [key])).rowCount) throw new ApiError("Unknown category.");
        await db.query(
          `INSERT INTO private.marketplace_pricing_rules(scope,scope_key,markup_bps,min_profit_cents,subscriber_discount_bps,updated_by)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (scope,scope_key) DO UPDATE SET markup_bps=$3,min_profit_cents=$4,subscriber_discount_bps=$5,updated_by=$6,updated_at=now()`,
          [
            scope,
            key,
            integer(Number(input.markup_bps), "markup", 0, 100000),
            integer(Number(input.min_profit_cents), "minimum profit", 0, 10000000),
            integer(Number(input.subscriber_discount_bps ?? 0), "subscriber discount", 0, 5000),
            token,
          ],
        );
        await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'pricing_rule_saved',$2)", [token, JSON.stringify({ scope, key, markup_bps: input.markup_bps, min_profit_cents: input.min_profit_cents })]);
      } else if (input.action === "delete-rule") {
        const id = uuid(input.ruleId);
        const r = await db.query("DELETE FROM private.marketplace_pricing_rules WHERE id=$1 AND scope<>'global' RETURNING scope,scope_key", [id]);
        if (!r.rowCount) throw new ApiError("The global rule can be edited but not removed.", 409);
        await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'pricing_rule_removed',$2)", [token, JSON.stringify(r.rows[0])]);
      } else throw new ApiError("Unknown action.");

      await db.query("COMMIT");
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      if ((error as { code?: string }).code === "23505") throw new ApiError("That record already exists.", 409);
      throw error;
    } finally {
      db.release();
    }
  } catch (error) {
    return failure(error);
  }
}
