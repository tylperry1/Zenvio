import { headers } from "next/headers";
import { getAuth } from "./auth";
import { configured } from "./server";

/** Lightweight signed-in check for root theme boot/provider. */
export async function themeSessionActive() {
  if (!configured()) return false;
  try {
    const current = await getAuth().api.getSession({ headers: await headers() });
    return Boolean(current?.user);
  } catch {
    return false;
  }
}
