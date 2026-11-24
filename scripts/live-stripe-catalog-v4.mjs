/**
 * The live Stripe objects created for catalog 2026-11-v4.
 * These are identifiers only; no secret or customer data belongs here.
 *
 * Existing v3 products/prices/subscriptions are intentionally absent.
 */
export const liveStripeCatalogV4 = Object.freeze({
  catalogVersion: "2026-11-v4",
  environment: "live",
  plans: Object.freeze([
    Object.freeze({ plan: "starter", period: "monthly", amount: 999, interval: "month", productId: "zenvio_starter_v4", priceId: "price_1Uf856QMz0wiUqo0uJsbCAd7" }),
    Object.freeze({ plan: "starter", period: "annual", amount: 9588, interval: "year", productId: "zenvio_starter_v4", priceId: "price_1Uf856QMz0wiUqo031WwUUOC" }),
    Object.freeze({ plan: "professional", period: "monthly", amount: 1999, interval: "month", productId: "zenvio_professional_v4", priceId: "price_1Uf856QMz0wiUqo01Os8BxRH" }),
    Object.freeze({ plan: "professional", period: "annual", amount: 19188, interval: "year", productId: "zenvio_professional_v4", priceId: "price_1Uf856QMz0wiUqo0Cg8swKNk" }),
    Object.freeze({ plan: "business", period: "monthly", amount: 3499, interval: "month", productId: "zenvio_business_v4", priceId: "price_1Uf856QMz0wiUqo0Swg6Qqk0" }),
    Object.freeze({ plan: "business", period: "annual", amount: 33588, interval: "year", productId: "zenvio_business_v4", priceId: "price_1Uf856QMz0wiUqo03dCh5asi" }),
    Object.freeze({ plan: "business_extra", period: "monthly", amount: 500, interval: "month", productId: "zenvio_business_extra_v4", priceId: "price_1Uf856QMz0wiUqo0usROIFRC" }),
    Object.freeze({ plan: "business_extra", period: "annual", amount: 4800, interval: "year", productId: "zenvio_business_extra_v4", priceId: "price_1Uf856QMz0wiUqo08pX6WTJv" }),
  ]),
  addons: Object.freeze([
    Object.freeze({ id: "ai_100", amount: 299, recurring: false, productId: "zenvio_addon_ai_100", priceId: "price_1Uf85EQMz0wiUqo0iQw4PDVk" }),
    Object.freeze({ id: "ai_500", amount: 999, recurring: false, productId: "zenvio_addon_ai_500", priceId: "price_1Uf85EQMz0wiUqo05lgnylml" }),
    Object.freeze({ id: "envelopes_10", amount: 999, recurring: false, productId: "zenvio_addon_envelopes_10", priceId: "price_1Uf85EQMz0wiUqo0TobtfVwI" }),
    Object.freeze({ id: "envelope_1", amount: 100, recurring: false, productId: "zenvio_addon_envelope_1", priceId: "price_1Uf85EQMz0wiUqo0zRBS3bD6" }),
    Object.freeze({ id: "video_1000", amount: 999, recurring: false, productId: "zenvio_addon_video_1000", priceId: "price_1Uf85EQMz0wiUqo0WIOYh6uy" }),
    Object.freeze({ id: "storage_10gb", amount: 299, recurring: true, productId: "zenvio_addon_storage_10gb", priceId: "price_1Uf85EQMz0wiUqo0SwGwRlu4" }),
    Object.freeze({ id: "sms_starter", amount: 1499, recurring: true, productId: "zenvio_addon_sms_starter", priceId: "price_1Uf85EQMz0wiUqo0oxQK8EBT" }),
    Object.freeze({ id: "sms_segment", amount: 3, recurring: false, productId: "zenvio_addon_sms_segment", priceId: "price_1Uf85EQMz0wiUqo0oUCA0aO5" }),
    // The seat add-on intentionally reuses the subscription seat product.
    Object.freeze({ id: "business_extra", amount: 500, recurring: true, productId: "zenvio_business_extra_v4", priceId: "price_1Uf856QMz0wiUqo0usROIFRC" }),
  ]),
});
