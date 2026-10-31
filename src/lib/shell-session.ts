import { headers } from "next/headers";
import { getAuth } from "./auth";
import { adminAccess } from "./admin";
import { configured } from "./server";
import { getPool } from "./db";
import { contractorIndustry } from "./contractor";

// Shell chrome only: pages still enforce their own session requirements.
export async function shellSession() {
  if (!configured()) return { user: null, admin: false, jobs: false };
  try {
    const current = await getAuth().api.getSession({ headers: await headers() });
    if (!current) return { user: null, admin: false, jobs: false };
    const [role, profile] = await Promise.all([
      adminAccess(current.user.id),
      getPool().query("SELECT industry FROM public.profiles WHERE id=$1", [current.user.id]),
    ]);
    return {
      user: { name: current.user.name || current.user.email, email: current.user.email },
      // Master admin and Zenvio employees both see the console link.
      admin: Boolean(role),
      // Contractor tools appear only for businesses that chose a trade preset.
      jobs: contractorIndustry(profile.rows[0]?.industry),
    };
  } catch {
    return { user: null, admin: false, jobs: false };
  }
}
