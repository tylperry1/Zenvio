import { integrationValue } from "../platform-settings";
import { ApiError } from "../server";
export async function printfulConfigured() { return process.env.PRINTFUL_CATALOG_ENABLED === "true" && Boolean(await integrationValue("PRINTFUL_API_KEY")); }
async function request(path: string) {
    if (!await printfulConfigured())
        throw new ApiError("Printful catalog access is not active.", 503);
    const key = await integrationValue("PRINTFUL_API_KEY");
    const r = await fetch("https://api.printful.com" + path, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12000) }), data = await r.json().catch(() => null);
    if (!r.ok || data?.code !== 200)
        throw new ApiError(r.status === 429 ? "Supplier catalog is rate limited; retry later." : "Supplier catalog is unavailable.", 503);
    return data.result;
}
export async function printfulCatalog(offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
        throw new ApiError("Invalid supplier page.");
    const products = await request("/products");
    if (!Array.isArray(products))
        throw new ApiError("Invalid supplier catalog response.", 503);
    return { products: products.slice(offset, offset + 50).map((p: any) => ({ id: p.id, title: p.title || p.model, brand: p.brand, image: p.image, type: p.type })), nextOffset: products.length > offset + 50 ? offset + 50 : null, source: "printful", orderSubmissionEnabled: false };
}
export async function printfulProduct(id: number) {
    if (!Number.isSafeInteger(id) || id < 1)
        throw new ApiError("Invalid supplier product.");
    const result = await request("/products/" + id);
    if (!result?.product || !Array.isArray(result.variants))
        throw new ApiError("Invalid supplier product response.", 503);
    return { source: "printful", product: { id: result.product.id, title: result.product.title, description: result.product.description }, variants: result.variants.map((v: any) => ({ supplierSku: String(v.id), name: v.name, size: v.size, color: v.color, basePrice: v.price, currency: result.product.currency || null, availability: typeof v.in_stock === "boolean" ? (v.in_stock ? "available" : "unavailable") : "unknown", isPurchasable: false })), orderSubmissionEnabled: false, limitation: "Base catalog costs exclude shipping, taxes and artwork. Commercial account, real SKU mapping and fulfillment acceptance remain required." };
}
