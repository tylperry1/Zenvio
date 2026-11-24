import "../admin.css";
import { AdminFrame } from "@/components/admin-frame";
export default function Layout({ children }: { children: React.ReactNode }) {
  // Same support area as Support desk, so the shared entry stays highlighted.
  return <AdminFrame view="support-ops" label="Support inbox">{children}</AdminFrame>;
}
