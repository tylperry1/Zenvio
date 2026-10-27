import { NextRequest } from "next/server";
import { storefront } from "@/lib/marketplace";
import { session, sameOrigin, body, failure, ApiError } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await session();
    const data = await storefront(
      `query { products(first:50,query:"tag:zenvio-branding") { nodes { id title description tags featuredImage { url altText } variants(first:20) { nodes { id title availableForSale price { amount currencyCode } } } } } }`,
    );
    return Response.json(
      { products: data.products.nodes },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    await session();
    const input = await body(request);
    if (
      !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(String(input.variant)) ||
      typeof input.quantity !== "number" ||
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 1000
    )
      throw new ApiError("Select a product and quantity between 1 and 1,000.");
    const allowed = await storefront(
      `query { products(first:50,query:"tag:zenvio-branding") { nodes { variants(first:20) { nodes { id availableForSale } } } } }`,
    );
    if (
      !allowed.products.nodes.some((p: any) =>
        p.variants.nodes.some(
          (v: any) => v.id === input.variant && v.availableForSale,
        ),
      )
    )
      throw new ApiError("This product is not available.");
    const data = await storefront(
      `mutation($input:CartInput!) { cartCreate(input:$input) { cart { checkoutUrl } userErrors { message } } }`,
      {
        input: {
          lines: [{ merchandiseId: input.variant, quantity: input.quantity }],
        },
      },
    );
    if (!data.cartCreate.cart?.checkoutUrl || data.cartCreate.userErrors.length)
      throw new ApiError("The store could not create your cart.", 502);
    return Response.json({ url: data.cartCreate.cart.checkoutUrl });
  } catch (e) {
    return failure(e);
  }
}
