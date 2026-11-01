import "../admin.css";
import "./gelato.css";
import { AdminFrame } from "@/components/admin-frame";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AdminFrame view="gelato" label="Gelato">
      {children}
    </AdminFrame>
  );
}
