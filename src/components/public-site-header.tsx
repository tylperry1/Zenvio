import Link from "next/link";
import { launchControls, publicRegistrationOpen } from "@/lib/launch-controls";
import { Logo } from "./icons";
import { PublicSiteNav } from "./public-site-nav";

/**
 * One public header for every marketing and account-adjacent page. The primary
 * action follows the same launch gate as the homepage, so it never links to a
 * closed signup.
 */
export async function PublicSiteHeader() {
  const controls = await launchControls();
  const join = publicRegistrationOpen(controls)
    ? { href: "/sign-up", label: "Get started" }
    : controls.waitlistEnabled
      ? { href: "/early-access", label: "Join early access" }
      : { href: "/demo", label: "Explore demo" };
  return (
    <header className="zv-site-header">
      <div className="zv-site-bar">
        <Link href="/" aria-label="Zenvio home" className="zv-site-logo">
          <Logo />
          <Logo light />
        </Link>
        <PublicSiteNav joinHref={join.href} joinLabel={join.label} />
      </div>
    </header>
  );
}
