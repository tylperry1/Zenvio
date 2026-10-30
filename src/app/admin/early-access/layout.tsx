import "../admin.css";
import { AdminFrame } from "@/components/admin-frame";
export default function Layout({children}:{children:React.ReactNode}){return <AdminFrame view="early-access" label="Early-access signups">{children}</AdminFrame>}
