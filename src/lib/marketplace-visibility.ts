import { getPool } from "./db";
import { ApiError, configured } from "./server";
export async function marketplaceVisible() {
  if (!configured()) return false;
  const result = await getPool().query("SELECT value FROM private.platform_settings WHERE key='marketplace'");
  return result.rows[0]?.value?.visible === true;
}
export async function requireMarketplaceVisible() {
  if (!(await marketplaceVisible())) throw new ApiError("The marketplace is currently unavailable.", 404);
}
