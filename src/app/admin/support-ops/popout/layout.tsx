import "../../admin.css";

/** Minimal chrome for the popped-out support workspace (no Master Admin nav). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="admin-v3 acx soc-popout-root">{children}</div>;
}