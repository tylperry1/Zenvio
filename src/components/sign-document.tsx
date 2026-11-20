"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "./icons";
import { LinkProblem } from "./ui";
import { download } from "@/lib/client";
import { Badge, Field, FormActions, Notice } from "./ds";

type Document = {
  id: string;
  title: string;
  content: string;
  recipient_name: string;
  recipient_email: string;
  sender_name: string;
  content_hash: string;
  status: string;
  signed_at: string | null;
  signature_name: string | null;
  receipt_hash: string | null;
};

export function SignDocument() {
  const token = useRef("");
  const [document, setDocument] = useState<Document | null>(null);
  const [consentText, setConsentText] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function request(action: string, extra: Record<string, unknown> = {}) {
    return fetch("/api/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token: token.current, ...extra }),
      cache: "no-store",
    });
  }

  useEffect(() => {
    token.current ||= new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    window.history.replaceState(null, "", window.location.pathname);
    if (!token.current) {
      setError("Open the complete private signing link provided by your sender.");
      return;
    }
    let active = true;
    request("read")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (active) {
          setDocument(d.document);
          setConsentText(d.consent);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="ds-root platform-page signing-page">
      <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px" }}>
        <header className="signing-brand" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <Logo />
          <span className="ds-muted">Private document signing</span>
        </header>

        {error && !document && <LinkProblem title="We couldn’t open this document">{error}</LinkProblem>}
        {error && document && (
          <Notice tone="danger">
            <span role="alert">{error}</span>
          </Notice>
        )}
        {!document && !error && <p className="ds-muted">Opening your document…</p>}

        {document && (
          <div className="ds-stack">
            <header className="ds-page-header">
              <div>
                <p className="ds-eyebrow">{document.status === "signed" ? "Signing complete" : "Review & sign"}</p>
                <h1>{document.title}</h1>
                <p className="ds-page-description">
                  {document.sender_name} prepared this agreement for {document.recipient_name} ({document.recipient_email}
                  ).
                </p>
              </div>
              <Badge tone={document.status === "signed" ? "success" : "info"}>
                {document.status === "signed" ? "Signed" : "Awaiting signature"}
              </Badge>
            </header>

            <section className="ds-panel">
              <div className="ds-panel-body">
                <div className="signing-content" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                  {document.content}
                </div>
                {document.status === "signed" && (
                  <div className="signature-record" style={{ marginTop: 24 }}>
                    <p className="ds-eyebrow">Electronic signature</p>
                    <strong>{document.signature_name}</strong>
                    <p className="ds-muted">
                      Signed {new Date(document.signed_at!).toLocaleString()} · {document.recipient_email}
                    </p>
                    <p>{consentText}</p>
                    <small className="ds-code">
                      Document ID: {document.id}
                      <br />
                      Document SHA-256: {document.content_hash}
                      <br />
                      Receipt SHA-256: {document.receipt_hash}
                    </small>
                    <p className="ds-muted">
                      Identity method: private signing link and self-attested typed name. Email ownership and government
                      identity were not independently verified.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {document.status === "signed" ? (
              <section className="ds-panel">
                <div className="ds-panel-body ds-stack">
                  <h2>Your signature has been recorded</h2>
                  <p className="ds-muted">Download the text copy and signing record, or print this page to save a PDF.</p>
                  <FormActions>
                    <button
                      className="ds-btn primary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          const r = await request("download");
                          if (!r.ok) throw new Error((await r.json()).error);
                          download(await r.text(), "zenvio-signed-agreement.txt", "text/plain;charset=utf-8");
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Unable to download.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Download signed copy
                    </button>
                    <button className="ds-btn" onClick={() => window.print()}>
                      Print / save PDF
                    </button>
                  </FormActions>
                </div>
              </section>
            ) : (
              <section className="ds-panel">
                <div className="ds-panel-body">
                  <h2>Add your signature</h2>
                  <p className="ds-muted">
                    Only continue if you are the intended recipient and have reviewed the complete agreement above.
                  </p>
                  <form
                    className="ds-stack"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (busy || !consent) return;
                      setBusy(true);
                      setError("");
                      try {
                        const r = await request("sign", { name, consent, content_hash: document.content_hash });
                        const d = await r.json();
                        if (!r.ok) throw new Error(d.error);
                        setDocument(d.document);
                        setConsentText(d.consent);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Unable to record signature.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Field label="Type your full name">
                      <input
                        required
                        minLength={2}
                        maxLength={100}
                        autoComplete="name"
                        value={name}
                        disabled={busy}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    {name && (
                      <div className="signature-preview" aria-label="Signature preview">
                        {name}
                      </div>
                    )}
                    <label className="ds-check">
                      <input
                        type="checkbox"
                        required
                        checked={consent}
                        disabled={busy}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <span>{consentText}</span>
                    </label>
                    <p className="ds-muted">
                      Your signature, consent, and signing time will be recorded with the document&apos;s SHA-256 hash.
                      The sender receives this record. Signing cannot be undone through this page.
                    </p>
                    <FormActions>
                      <button className="ds-btn primary" disabled={busy || !consent || name.trim().length < 2}>
                        {busy ? "Recording signature…" : "Agree & sign document"}
                      </button>
                    </FormActions>
                  </form>
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
