import { headers } from "next/headers";
import type { ReactNode } from "react";
import { getAuth } from "@/lib/auth";
import { adminAccess } from "@/lib/admin";
import { configured } from "@/lib/server";
import { AdminAccessProvider, type ConsoleAccess } from "@/components/admin-access";

// Supplies the signed-in admin's role to the console navigation. Each page and
// API route still enforces access independently.
async function currentAccess(): Promise<ConsoleAccess | null> {
  if (!configured()) return null;
  try {
    const current = await getAuth().api.getSession({ headers: await headers() });
    if (!current) return null;
    const access = await adminAccess(current.user.id);
    return access
      ? { ...access, name: current.user.name || current.user.email, email: current.user.email }
      : null;
  } catch {
    return null;
  }
}
export default async function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminAccessProvider value={await currentAccess()}>{children}</AdminAccessProvider>;
}
