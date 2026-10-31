import "../admin.css";
import { AdminFrame } from "@/components/admin-frame";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AdminFrame view="team" label="Team & access">
      {children}
    </AdminFrame>
  );
}
