"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";

export type PaletteItem = {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  href: string;
  group: string;
  keywords?: string;
};

export function CommandPalette({
  open,
  onClose,
  items,
  searchClients,
}: {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
  searchClients: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [clients, setClients] = useState<PaletteItem[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setClients([]);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || !searchClients || q.length < 2) {
      setClients([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/clients?" + new URLSearchParams({ q }), { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { contacts: [] }))
        .then((d) =>
          setClients(
            (d.contacts || []).slice(0, 6).map((c: any) => ({
              id: "client-" + c.id,
              label: c.name,
              hint: [c.email, c.company].filter(Boolean).join(" · "),
              icon: "contact",
              href: "/app/clients?client=" + c.id,
              group: "Clients",
            })),
          ),
        )
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, searchClients]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? items.filter((i) =>
          `${i.label} ${i.group} ${i.keywords || ""}`.toLowerCase().includes(q),
        )
      : items;
    return [...matched, ...clients];
  }, [items, clients, query]);

  useEffect(() => setActive(0), [query, clients.length]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  function go(item?: PaletteItem) {
    if (!item) return;
    onClose();
    router.push(item.href);
  }
  let lastGroup = "";
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input
            ref={input}
            value={query}
            placeholder={searchClients ? "Search pages, actions, and clients…" : "Search pages and actions…"}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? "palette-" + results[active].id : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(results[active]);
              } else if (e.key === "Escape") onClose();
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="palette-results" ref={list} role="listbox">
          {results.map((item, index) => {
            const heading = item.group !== lastGroup ? item.group : "";
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {heading && <p className="palette-group">{heading}</p>}
                <button
                  id={"palette-" + item.id}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  className={index === active ? "active" : ""}
                  onMouseMove={() => setActive(index)}
                  onClick={() => go(item)}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                  {item.hint && <small>{item.hint}</small>}
                </button>
              </li>
            );
          })}
          {!results.length && (
            <li className="palette-empty">
              No results for “{query.trim()}”.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
