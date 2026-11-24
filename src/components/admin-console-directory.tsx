"use client";
import Link from "next/link";
import { adminNavGroups, navItemAllowed } from "@/lib/admin-console-nav";
import { useCan } from "./admin-access";
import { Icon } from "./icons";

/**
 * Grouped index of every admin area, generated from the same navigation config
 * as the sidebar so the two can never drift apart. Items the signed-in operator
 * cannot open are omitted.
 */
export function ConsoleDirectory() {
  const can = useCan();
  return (
    <section className="av-console-directory" aria-label="Console directory">
      <header className="av-console-directory-head">
        <div>
          <h2>Console directory</h2>
          <p>Every admin area in one index, grouped exactly like the sidebar.</p>
        </div>
      </header>
      <div className="av-console-directory-groups">
        {adminNavGroups.map((group) => {
          const items = group.items.filter((item) => navItemAllowed(item, can));
          if (!items.length) return null;
          return (
            <div className="av-console-directory-group" key={group.label}>
              <div className="av-console-directory-label">
                <h3>{group.label}</h3>
                <p>{group.description}</p>
              </div>
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href}>
                      <span className="av-console-directory-icon">
                        <Icon name={item.icon} size={16} />
                      </span>
                      <span className="av-console-directory-copy">
                        <b>{item.label}</b>
                        <small>{item.note}</small>
                      </span>
                      <Icon name="arrow" size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
