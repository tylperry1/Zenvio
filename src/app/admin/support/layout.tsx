import "../admin.css";
import { AdminFrame } from "@/components/admin-frame";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AdminFrame view="support" label="Customer support">{children}</AdminFrame>;
}
