import type { PoolClient } from "pg";
import { ApiError, string, uuid, integer } from "./server";
export type ProductOption = {
  key: string;
  label: string;
  values: { value: string; price_delta_cents: number; supplier_sku: string }[];
};
export function optionSchema(value: unknown): ProductOption[] {
  if (!Array.isArray(value) || value.length > 6)
    throw new ApiError("Use up to six product options.");
  const result = value.map((v) => {
    const values = Array.isArray(v.values)
      ? v.values.map((o: any) => ({
          value: string(o.value, "option value", 80),
          price_delta_cents: integer(
            o.price_delta_cents || 0,
            "price adjustment",
            0,
            1000000,
          ),
          supplier_sku: string(
            o.supplier_sku || "",
            "supplier variant SKU",
            100,
            0,
          ),
        }))
      : [];
    if (
      !values.length ||
      values.length > 20 ||
      new Set(values.map((o: any) => o.value)).size !== values.length
    )
      throw new ApiError("Provide 1–20 distinct option values.");
    return {
      key: string(v.key, "option key", 40),
      label: string(v.label, "option label", 80),
      values,
    };
  });
  if (new Set(result.map((r) => r.key)).size !== result.length)
    throw new ApiError("Option keys must be distinct.");
  return result;
}
export async function resolvePersonalization(
  db: PoolClient,
  product: any,
  user: string,
  input: any,
) {
  const schema = optionSchema(product.personalization_options || []),
    selected =
      input?.options &&
      typeof input.options === "object" &&
      !Array.isArray(input.options)
        ? input.options
        : {};
  const choices: any[] = [];
  let extra = 0;
  for (const option of schema) {
    const choice = option.values.find((v) => v.value === selected[option.key]);
    if (!choice)
      throw new ApiError("Choose " + option.label + " for " + product.title);
    extra += choice.price_delta_cents;
    choices.push({ key: option.key, label: option.label, ...choice });
  }
  let artwork = null;
  if (input?.artwork_id) {
    if (!product.artwork_allowed)
      throw new ApiError("Artwork is not accepted for this product.");
    artwork = (
      await db.query(
        "SELECT id,sha256,width,height FROM private.marketplace_artwork WHERE id=$1 AND user_id=$2",
        [uuid(input.artwork_id), user],
      )
    ).rows[0];
    if (!artwork) throw new ApiError("Artwork not found.", 404);
  }
  return {
    extra,
    snapshot: {
      choices,
      instructions: string(
        input?.instructions || "",
        "personalization instructions",
        1000,
        0,
      ),
      artwork,
      preview: "Illustrative preview only; not a production proof.",
    },
    artwork_id: artwork?.id || null,
  };
}
export interface SupplierAdapter {
  configured: boolean;
  submit(input: {
    orderId: string;
    supplierId: string;
  }): Promise<{ reference: string }>;
}
export const manualSupplierAdapter: SupplierAdapter = {
  configured: false,
  async submit() {
    throw new ApiError(
      "Automatic supplier submission is not configured. Use the manual fulfillment workflow.",
      503,
    );
  },
};
