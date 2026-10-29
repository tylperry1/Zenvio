import "../admin.css";
import { AdminFrame } from "@/components/admin-frame";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AdminFrame view="entitlements" label="Plans & entitlements">
      {children}
    </AdminFrame>
  );
}
