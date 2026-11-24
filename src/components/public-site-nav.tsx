"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

const links = [
  { href: "/", label: "Home" },
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function PublicSiteNav({ joinHref, joinLabel }: { joinHref: string; joinLabel: string }) {
  const pathname = usePathname() || "/";
  return (
    <>
      <nav className="zv-site-nav" aria-label="Main navigation">
        {links.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={active ? "is-active" : undefined}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="zv-site-actions">
        <Link className="zv-site-signin" href="/sign-in">
          Sign in
        </Link>
        <Link className="zv-site-cta" href={joinHref}>
          {joinLabel}
        </Link>
        <details className="zv-site-mobile">
          <summary aria-label="Open navigation">
            <Icon name="menu" size={20} />
          </summary>
          <nav aria-label="Mobile navigation">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={isActive(pathname, link.href) ? "is-active" : undefined}
                aria-current={isActive(pathname, link.href) ? "page" : undefined}
              >
                {link.label}
              </Link>
            ))}
            <Link href="/help">Help</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/sign-in">Sign in</Link>
            <Link href={joinHref} className="zv-site-menu-cta">
              {joinLabel}
            </Link>
          </nav>
        </details>
      </div>
    </>
  );
}
