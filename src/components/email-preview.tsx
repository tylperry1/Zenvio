"use client";
import { useEffect, useState } from "react";
import { Notice, PageHeader, Panel } from "./ds";

export function EmailPreview() {
  const [preview, setPreview] = useState<{ html: string; text: string; subject: string; samples: { id: string; label: string }[] } | null>(null);
  const [sample, setSample] = useState("welcome");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/email-preview?sample=" + sample, { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setPreview(result);
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message || "Unable to load preview."); });
    return () => controller.abort();
  }, [sample]);
  return <div className="ds-root">
    <PageHeader title="Transactional email preview" description="Preview the shared account and notification layout. Test sends go to your administrator email." />
    {error && <Notice tone="danger">{error}</Notice>}
    {sent && <Notice tone="success">Preview email accepted for delivery. Check your inbox.</Notice>}
    <button className="ds-btn primary" disabled={busy} onClick={async () => {
      setBusy(true); setError(""); setSent(false);
      try {
        const response = await fetch("/api/admin/email-preview", { method: "POST" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to send preview.");
        setSent(true);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to send preview."); }
      finally { setBusy(false); }
    }}>{busy ? "Sending…" : "Send preview to me"}</button>
    {preview && <div className="ds-segmented" role="group" aria-label="Email" style={{ margin: "16px 0" }}>
      {preview.samples.map((s) => <button key={s.id} type="button" aria-pressed={sample === s.id} onClick={() => setSample(s.id)}>{s.label}</button>)}
    </div>}
    {preview && <><Panel title={`Subject: ${preview.subject}`}><iframe title="Zenvio transactional email" sandbox="" srcDoc={preview.html} style={{ width: "100%", height: 760, border: 0 }} /></Panel>
      <Panel title="Plain text"><pre style={{ whiteSpace: "pre-wrap" }}>{preview.text}</pre></Panel></>}
  </div>;
}
