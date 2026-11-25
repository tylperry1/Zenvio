"use client";

import { useEffect, useState } from "react";
import { FormActions, Notice, Panel, Segmented } from "./ds";
import { AdminPageHeader } from "./admin-page-header";

type Preview = {
  html: string;
  text: string;
  subject: string;
  samples: { id: string; label: string }[];
};

export function EmailPreview() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sample, setSample] = useState("welcome");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch("/api/admin/email-preview?sample=" + sample, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setPreview(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message || "Unable to load preview.");
      });
    return () => controller.abort();
  }, [sample]);

  return (
    <div className="ds-root">
      <AdminPageHeader
        title="Transactional email preview"
        description="Preview the shared account and notification layout. Test sends go to your administrator email."
        actions={
          <button
            className="ds-btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setSent(false);
              try {
                const response = await fetch("/api/admin/email-preview", { method: "POST" });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || "Unable to send preview.");
                setSent(true);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Unable to send preview.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Sending…" : "Send preview to me"}
          </button>
        }
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {sent && <Notice tone="success">Preview email accepted for delivery. Check your inbox.</Notice>}

      {preview && (
        <div className="ds-toolbar">
          <Segmented
            label="Email sample"
            value={sample}
            onChange={setSample}
            options={preview.samples.map((s) => [s.id, s.label] as const)}
          />
        </div>
      )}

      {preview && (
        <div className="ds-stack">
          <Panel title={`Subject: ${preview.subject}`} description="Rendered HTML as customers would receive it.">
            <iframe
              title="Zenvio transactional email"
              sandbox=""
              srcDoc={preview.html}
              style={{ width: "100%", height: 760, border: 0, borderRadius: 8, background: "var(--surface)" }}
            />
          </Panel>
          <Panel title="Plain text" description="Fallback body for clients that do not render HTML.">
            <pre className="ds-code" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
              {preview.text}
            </pre>
          </Panel>
          <FormActions>
            <span className="ds-muted">Samples load from the live template set. Sending posts to your admin inbox only.</span>
          </FormActions>
        </div>
      )}
    </div>
  );
}
