"use client";
import { useEffect, useState } from "react";

// Builds an "On this page" index from the legal page's section headings so the
// legal text itself stays untouched.
export function LegalToc() {
  const [items, setItems] = useState<{ id: string; text: string }[]>([]);
  useEffect(() => {
    const headings = Array.from(document.querySelectorAll<HTMLHeadingElement>(".legal-page h2"));
    setItems(
      headings.map((h) => {
        if (!h.id) h.id = (h.textContent || "section").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return { id: h.id, text: h.textContent || "" };
      }),
    );
  }, []);
  if (items.length < 3) return null;
  return (
    <nav className="legal-toc" aria-label="On this page">
      <p>On this page</p>
      <ol>
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`}>{i.text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
