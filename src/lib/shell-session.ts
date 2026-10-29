import { headers } from "next/headers";
import { getAuth } from "./auth";
import { platformRole } from "./admin";
import { configured } from "./server";

// Shell chrome only: pages still enforce their own session requirements.
export async function shellSession() {
  if (!configured()) return { user: null, admin: false };
  try {
    const current = await getAuth().api.getSession({ headers: await headers() });
    if (!current) return { user: null, admin: false };
    return {
      user: { name: current.user.name || current.user.email, email: current.user.email },
      admin: (await platformRole(current.user.id)) === "master_admin",
    };
  } catch {
    return { user: null, admin: false };
  }
}
