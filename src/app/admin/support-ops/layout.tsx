import "../admin.css";

/**
 * Shared chrome for Support Ops. AdminFrame lives on the framed page only so
 * the dedicated /popout route can open without Master Admin navigation.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
