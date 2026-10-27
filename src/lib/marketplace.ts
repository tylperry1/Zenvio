import { integrationValue } from "./platform-settings";
import { ApiError } from "./server";
export async function storefront(
  query: string,
  variables: Record<string, unknown> = {},
) {
  const domain = await integrationValue("SHOPIFY_STORE_DOMAIN"),
    token = await integrationValue("SHOPIFY_STOREFRONT_TOKEN");
  if (!domain || !token)
    throw new ApiError("The branding marketplace is not connected yet.", 503);
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain))
    throw new ApiError("Use your store’s myshopify.com domain.", 503);
  const r = await fetch(`https://${domain}/api/2026-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
    redirect: "error",
  });
  const data = await r.json();
  if (!r.ok || data.errors)
    throw new ApiError("The store could not complete this request.", 502);
  return data.data;
}
