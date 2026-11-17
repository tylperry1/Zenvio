import "../../admin.css";

/**
 * Minimal chrome for the popped-out support workspace (no Master Admin nav).
 * Keeps `.admin-v3.acx` so Support Ops styles apply; `.soc-popout-root` clears
 * the console sidebar gradient that would otherwise paint a fake navy rail.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="admin-v3 acx soc-popout-root">{children}</div>;
}