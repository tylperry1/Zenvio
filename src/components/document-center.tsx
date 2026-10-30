"use client";
import { useEffect, useState } from "react";
import { Documents } from "./documents";
import { Envelopes } from "./envelopes";
type Tab = "pdf" | "text";
export function DocumentCenter() {
  const [tab, setTab] = useState<Tab>("pdf");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "text")
      setTab("text");
  }, []);
  function choose(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "text") url.searchParams.set("tab", "text");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  }
  const tabs = (
    <div className="document-tabs">
      <nav className="envelope-tabs" aria-label="Document type">
        <button
          className={tab === "pdf" ? "active" : ""}
          aria-pressed={tab === "pdf"}
          onClick={() => choose("pdf")}
        >
          PDF documents
        </button>
        <button
          className={tab === "text" ? "active" : ""}
          aria-pressed={tab === "text"}
          onClick={() => choose("text")}
        >
          Text agreements
        </button>
      </nav>
      <p>
        {tab === "pdf"
          ? "Upload a PDF, place signature and form fields, and send it to one or more recipients."
          : "Write a short agreement in plain text and share a private link for one recipient to sign."}
      </p>
    </div>
  );
  return tab === "text" ? <Documents tabs={tabs} /> : <Envelopes tabs={tabs} />;
}
