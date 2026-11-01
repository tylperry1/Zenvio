"use client";
import { useState } from "react";
import { Icon } from "./icons";

type Item = { icon: string; title: string; items: string[] };
const PREVIEW = 3;

// On phones each card shows its first few items with an expand control so the
// page stays scannable; on larger screens CSS shows every item.
export function CapabilityGrid({ items }: { items: Item[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="mk-capability-grid">
      {items.map(({ icon, title, items: list }) => {
        const expanded = !!open[title];
        const extra = list.length - PREVIEW;
        return (
          <article key={title} data-expanded={expanded}>
            <span className="mk-feature-icon">
              <Icon name={icon} size={22} />
            </span>
            <h3>{title}</h3>
            <ul id={`cap-${title.replace(/\W+/g, "-")}`}>
              {list.map((item, i) => (
                <li key={item} className={i >= PREVIEW ? "mk-cap-extra" : undefined}>
                  <Icon name="check" size={15} />
                  {item}
                </li>
              ))}
            </ul>
            {extra > 0 && (
              <button
                type="button"
                className="mk-cap-toggle"
                aria-expanded={expanded}
                aria-controls={`cap-${title.replace(/\W+/g, "-")}`}
                onClick={() => setOpen((o) => ({ ...o, [title]: !expanded }))}
              >
                {expanded ? "Show less" : `Show ${extra} more`}
                <Icon name="chevronDown" size={14} />
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
