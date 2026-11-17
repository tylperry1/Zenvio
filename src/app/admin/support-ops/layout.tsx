import "../admin.css";
import { AdminFrame } from "@/components/admin-frame";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AdminFrame view="support-ops" label="Support Operations">
      {children}
    </AdminFrame>
  );
}
