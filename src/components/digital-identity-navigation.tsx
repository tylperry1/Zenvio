"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Digital Identity Management Center — one place for profiles, cards, NFC, QR, contacts, analytics. */
const links = [
  ["My Profiles", "/app/identity"],
  ["Smart Cards", "/app/identity/cards"],
  ["NFC Studio", "/app/identity/nfc"],
  ["QR Codes", "/app/identity/qr"],
  ["Contact Exchange", "/app/identity/contacts"],
  ["Analytics", "/app/identity/analytics"],
  ["Design & Branding", "/app/identity/design"],
] as const;

export function DigitalIdentityNavigation() {
  const path = usePathname();
  return (
    <nav className="growth-navigation di-navigation" aria-label="Digital Identity sections">
      <Link className="growth-brand" href="/app/identity">
        Digital Identity
      </Link>
      <div className="growth-navigation-links">
        {links.map(([name, href]) => {
          const active =
            href === "/app/identity"
              ? path === "/app/identity" || path === "/app/identity/"
              : path === href || path.startsWith(`${href}/`);
          return (
            <Link key={name} href={href} aria-current={active ? "page" : undefined}>
              {name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
