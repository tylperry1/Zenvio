"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { StaffPermission } from "@/lib/admin-sections";

export type ConsoleAccess = {
  role: "master_admin" | "staff";
  title: string;
  permissions: StaffPermission[];
  name: string;
  email: string;
};
const Context = createContext<ConsoleAccess | null>(null);
export function AdminAccessProvider({
  value,
  children,
}: {
  value: ConsoleAccess | null;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAdminAccess() {
  return useContext(Context);
}
// Client-side visibility only; every route re-checks access on the server.
export function useCan() {
  const access = useAdminAccess();
  return (permission: StaffPermission | "team") =>
    !!access &&
    (access.role === "master_admin" ||
      (permission !== "team" && access.permissions.includes(permission)));
}
