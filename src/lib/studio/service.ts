import type { PoolClient } from "pg";
import { getPool } from "../db";
import { ApiError, uuid } from "../server";
import { DesignError, parseDesign, parsePrintAreas, validateDesign, type AssetInfo, type DesignConfig, type PrintArea } from "./design";
import { AssetError, normalizeArtwork } from "./assets";
import { renderPrintFile, type AssetData } from "./print-file";

// Brand Studio persistence. Ownership is always enforced in SQL: a user sees
// only their rows; a guest only rows bound to their hashed browser token.

export type Owner = { userId: string | null; guestHash: string | null };
type DB = Pick<PoolClient, "query">;

function own(o: Owner, index: number, alias = "") {
  const p = alias ? alias + "." : "";
  if (o.userId) return { sql: `${p}user_id=$${index}`, param: o.userId };
  if (o.guestHash) return { sql: `${p}guest_hash=$${index} AND ${p}user_id IS NULL`, param: o.guestHash };
  throw new ApiError("Please sign in to continue.", 401);
}
const wrap = (e: unknown): never => {
  if (e instanceof DesignError || e instanceof AssetError) throw new ApiError(e.message);
  throw e;
};

// ---------- Assets ----------
export async function listAssets(o: Owner) {
  const w = own(o, 1);
  return (
    await getPool().query(
      `SELECT id,filename,source_format,width,height,has_alpha,created_at FROM private.brand_assets WHERE ${w.sql} AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 60`,
      [w.param],
    )
  ).rows;
}
export async function uploadAsset(o: Owner, bytes: Buffer, filename: string) {
  const asset = await normalizeArtwork(bytes, filename).catch(wrap);
  const w = own(o, 1);
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["studio-assets:" + w.param]);
    const n = (await db.query(`SELECT count(*)::int n FROM private.brand_assets WHERE ${w.sql} AND created_at>now()-interval '1 day'`, [w.param])).rows[0].n;
    if (n >= (o.userId ? 30 : 10)) throw new ApiError("Daily artwork upload limit reached. Try again tomorrow.", 429);
    const row = (
      await db.query(
        "INSERT INTO private.brand_assets(user_id,guest_hash,filename,source_format,mime,image,width,height,has_alpha,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,filename,source_format,width,height,has_alpha,created_at",
        [o.userId, o.userId ? null : o.guestHash, asset.filename, asset.source, asset.mime, asset.image, asset.width, asset.height, asset.hasAlpha, asset.sha256],
      )
    ).rows[0];
    await db.query("COMMIT");
    return row;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function deleteAsset(o: Owner, id: string) {
  const w = own(o, 2);
  const r = await getPool().query(`UPDATE private.brand_assets SET deleted_at=now() WHERE id=$1 AND ${w.sql} AND deleted_at IS NULL RETURNING id`, [uuid(id), w.param]);
  if (!r.rowCount) throw new ApiError("Artwork not found.", 404);
}
export async function assetImage(o: Owner | "admin", id: string) {
  const params: unknown[] = [uuid(id)];
  let where = "";
  if (o !== "admin") {
    const w = own(o, 2);
    where = ` AND ${w.sql}`;
    params.push(w.param);
  }
  const r = (await getPool().query(`SELECT image,mime FROM private.brand_assets WHERE id=$1${where}`, params)).rows[0];
  if (!r) throw new ApiError("Artwork not found.", 404);
  return r as { image: Buffer; mime: string };
}

// ---------- Studio product context ----------
export async function studioProduct(productId: string, options: { includeDrafts?: boolean } = {}, db: DB = getPool()) {
  const row = (
    await db.query(
      `SELECT p.id,p.title,p.status,sp.id AS supplier_product_id,sp.print_areas,sp.studio_enabled,sp.purchasing_paused
         FROM private.marketplace_products p JOIN private.supplier_products sp ON sp.product_id=p.id
        WHERE p.id=$1 ${options.includeDrafts ? "" : "AND p.status='active'"}`,
      [uuid(productId)],
    )
  ).rows[0];
  if (!row) throw new ApiError("This product is not available for customization.", 404);
  let areas: PrintArea[] = [];
  try {
    areas = parsePrintAreas(row.print_areas);
  } catch {
    areas = [];
  }
  if (!row.studio_enabled || !areas.length) throw new ApiError("This product does not offer online customization yet.", 409);
  return { ...row, areas };
}

async function ownedAssets(o: Owner, design: DesignConfig, db: DB, withData = false) {
  const ids = [...new Set(Object.values(design.areas).flat().filter((l) => l.type === "image").map((l) => (l as { assetId: string }).assetId))];
  const map = new Map<string, AssetData>();
  if (!ids.length) return map;
  const w = own(o, 2);
  const rows = (
    await db.query(
      `SELECT id,width,height,has_alpha,mime${withData ? ",image" : ""} FROM private.brand_assets WHERE id=ANY($1::uuid[]) AND ${w.sql} AND deleted_at IS NULL`,
      [ids, w.param],
    )
  ).rows;
  for (const r of rows) map.set(r.id, r);
  return map;
}

// ---------- Designs ----------
const designColumns = "id,product_id,variant_id,name,config,status,validation,approved_at,revision,created_at,updated_at";
export async function listDesigns(o: Owner) {
  const w = own(o, 1, "d");
  return (
    await getPool().query(
      `SELECT d.id,d.product_id,d.variant_id,d.name,d.status,d.revision,d.updated_at,p.title AS product_title FROM private.saved_designs d JOIN private.marketplace_products p ON p.id=d.product_id WHERE ${w.sql} ORDER BY d.updated_at DESC LIMIT 50`,
      [w.param],
    )
  ).rows;
}
export async function getDesign(o: Owner, id: string, db: DB = getPool()) {
  const w = own(o, 2);
  const row = (await db.query(`SELECT ${designColumns} FROM private.saved_designs WHERE id=$1 AND ${w.sql}`, [uuid(id), w.param])).rows[0];
  if (!row) throw new ApiError("Design not found.", 404);
  const proofs = (await db.query("SELECT id,area,width_mm,height_mm,min_effective_dpi,warnings,created_at FROM private.design_proofs WHERE design_id=$1 AND design_revision=$2 ORDER BY area", [row.id, row.revision])).rows;
  return { ...row, proofs };
}

export async function saveDesign(o: Owner, input: { id?: unknown; productId: unknown; variantId: unknown; name?: unknown; config: unknown }) {
  const product = await studioProduct(String(input.productId));
  const variantId = uuid(input.variantId);
  const variant = (await getPool().query("SELECT id FROM private.supplier_variants WHERE id=$1 AND supplier_product_id=$2 AND enabled", [variantId, product.supplier_product_id])).rows[0];
  if (!variant) throw new ApiError("Choose an available product option.");
  let config: DesignConfig;
  try {
    config = parseDesign(input.config, product.areas);
  } catch (e) {
    return wrap(e);
  }
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 100) : "Untitled design";
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const assets = await ownedAssets(o, config, db);
    const validation = validateDesign(config, product.areas, assets as Map<string, AssetInfo>);
    let row;
    if (input.id) {
      const w = own(o, 6);
      // Any edit returns an approved design to draft under a new revision; proofs of older revisions remain for placed orders.
      row = (
        await db.query(
          `UPDATE private.saved_designs SET name=$2,config=$3,variant_id=$4,validation=$5,status=CASE WHEN status='approved' AND config=$3::jsonb AND variant_id=$4 THEN status ELSE 'draft' END,revision=CASE WHEN config=$3::jsonb AND variant_id=$4 THEN revision ELSE revision+1 END,approved_at=CASE WHEN config=$3::jsonb AND variant_id=$4 THEN approved_at ELSE NULL END,updated_at=now() WHERE id=$1 AND product_id=$7 AND ${w.sql} RETURNING ${designColumns}`,
          [uuid(input.id), name, JSON.stringify(config), variantId, JSON.stringify(validation), w.param, product.id],
        )
      ).rows[0];
      if (!row) throw new ApiError("Design not found.", 404);
    } else {
      const w = own(o, 1);
      const count = (await db.query(`SELECT count(*)::int n FROM private.saved_designs WHERE ${w.sql} AND created_at>now()-interval '1 day'`, [w.param])).rows[0].n;
      if (count >= 50) throw new ApiError("Daily design limit reached.", 429);
      row = (
        await db.query(
          `INSERT INTO private.saved_designs(user_id,guest_hash,product_id,variant_id,name,config,validation) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${designColumns}`,
          [o.userId, o.userId ? null : o.guestHash, product.id, variantId, name, JSON.stringify(config), JSON.stringify(validation)],
        )
      ).rows[0];
    }
    await db.query("COMMIT");
    return { ...row, proofs: [] };
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}

/**
 * Final proof approval: re-validates server-side against the supplier print
 * specification, renders production PDFs for every used print area and only
 * then marks the revision approved. Unapproved designs can never be ordered.
 */
export async function approveDesign(o: Owner, id: string, expectedRevision: number) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const w = own(o, 2);
    const design = (await db.query(`SELECT ${designColumns} FROM private.saved_designs WHERE id=$1 AND ${w.sql} FOR UPDATE`, [uuid(id), w.param])).rows[0];
    if (!design) throw new ApiError("Design not found.", 404);
    if (design.revision !== expectedRevision) throw new ApiError("This design changed. Review the latest version before approving.", 409);
    const product = await studioProduct(design.product_id, {}, db);
    const config = (() => {
      try {
        return parseDesign(design.config, product.areas);
      } catch (e) {
        return wrap(e);
      }
    })();
    const assets = await ownedAssets(o, config, db, true);
    const validation = validateDesign(config, product.areas, assets);
    if (!validation.ok) {
      await db.query("UPDATE private.saved_designs SET validation=$2 WHERE id=$1", [design.id, JSON.stringify(validation)]);
      await db.query("COMMIT");
      throw new ApiError(validation.errors[0], 422);
    }
    for (const area of product.areas) {
      if (!(config.areas[area.key] || []).length) continue;
      const { file, sha256 } = await renderPrintFile(area, config, assets);
      await db.query(
        "INSERT INTO private.design_proofs(design_id,design_revision,area,file,mime,sha256,width_mm,height_mm,min_effective_dpi,warnings) VALUES($1,$2,$3,$4,'application/pdf',$5,$6,$7,$8,$9) ON CONFLICT(design_id,design_revision,area) DO UPDATE SET file=$4,sha256=$5,warnings=$9,created_at=now()",
        [design.id, design.revision, area.key, file, sha256, area.width_mm + 2 * area.bleed_mm, area.height_mm + 2 * area.bleed_mm, validation.areas[area.key]?.minDpi ?? null, JSON.stringify(validation.warnings)],
      );
    }
    await db.query("UPDATE private.saved_designs SET status='approved',approved_at=now(),validation=$2,updated_at=now() WHERE id=$1", [design.id, JSON.stringify(validation)]);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
  return getDesign(o, id);
}

export async function proofFile(o: Owner | "admin", proofId: string) {
  const params: unknown[] = [uuid(proofId)];
  let where = "";
  if (o !== "admin") {
    const w = own(o, 2, "d");
    where = ` AND ${w.sql}`;
    params.push(w.param);
  }
  const r = (await getPool().query(`SELECT f.file,f.area FROM private.design_proofs f JOIN private.saved_designs d ON d.id=f.design_id WHERE f.id=$1${where}`, params)).rows[0];
  if (!r) throw new ApiError("Proof not found.", 404);
  return r as { file: Buffer; area: string };
}

/** Binds guest designs and assets to a user account when they sign in. */
export async function claimGuestWork(userId: string, guestHash: string) {
  await getPool().query("UPDATE private.brand_assets SET user_id=$1,guest_hash=NULL WHERE guest_hash=$2 AND user_id IS NULL", [userId, guestHash]);
  await getPool().query("UPDATE private.saved_designs SET user_id=$1,guest_hash=NULL WHERE guest_hash=$2 AND user_id IS NULL", [userId, guestHash]);
}
