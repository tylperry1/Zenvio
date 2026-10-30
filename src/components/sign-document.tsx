"use client";
import { useEffect, useRef, useState } from "react";
import { Logo } from "./icons";
import { LinkProblem } from "./ui";
import { download } from "@/lib/client";
type Document = { id: string; title: string; content: string; recipient_name: string; recipient_email: string; sender_name: string; content_hash: string; status: string; signed_at: string | null; signature_name: string | null; receipt_hash: string | null };
export function SignDocument() {
  const token = useRef("");
  const [document, setDocument] = useState<Document | null>(null), [consentText, setConsentText] = useState("");
  const [name, setName] = useState(""), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function request(action: string, extra: Record<string, unknown> = {}) {
    return fetch("/api/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, token: token.current, ...extra }), cache: "no-store" });
  }
  useEffect(() => {
    token.current ||= new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    window.history.replaceState(null, "", window.location.pathname);
    if (!token.current) { setError("Open the complete private signing link provided by your sender."); return; }
    let active = true;
    request("read").then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); if (active) { setDocument(d.document); setConsentText(d.consent); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  return <div className="platform-page signing-page"><main>
    <header className="signing-brand"><Logo /><span>Private document signing</span></header>
    {error && !document && <LinkProblem title="We couldn’t open this document">{error}</LinkProblem>}
    {error && document && <p role="alert" className="billing-error">{error}</p>}
    {!document && !error && <p>Opening your document…</p>}
    {document && <>
      <div className="signing-introduction"><span className="billing-eyebrow">{document.status === "signed" ? "SIGNING COMPLETE" : "REVIEW & SIGN"}</span><h1>{document.title}</h1><p>{document.sender_name} prepared this agreement for {document.recipient_name} ({document.recipient_email}).</p></div>
      <section className="signing-sheet"><h2>{document.title}</h2><div className="signing-content">{document.content}</div>
        {document.status === "signed" && <div className="signature-record"><span className="billing-eyebrow">ELECTRONIC SIGNATURE</span><strong>{document.signature_name}</strong><p>Signed {new Date(document.signed_at!).toLocaleString()} · {document.recipient_email}</p><p>{consentText}</p><small>Document ID: {document.id}<br />Document SHA-256: {document.content_hash}<br />Receipt SHA-256: {document.receipt_hash}</small><p>Identity method: private signing link and self-attested typed name. Email ownership and government identity were not independently verified.</p></div>}
      </section>
      {document.status === "signed" ? <section className="signing-complete"><h2>Your signature has been recorded</h2><p>Download the text copy and signing record, or print this page to save a PDF.</p><button disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const r = await request("download"); if (!r.ok) throw new Error((await r.json()).error); download(await r.text(), "zenvio-signed-agreement.txt", "text/plain;charset=utf-8"); } catch (e) { setError(e instanceof Error ? e.message : "Unable to download."); } finally { setBusy(false); } }}>Download signed copy</button><button className="billing-secondary" onClick={() => window.print()}>Print / save PDF</button></section> : <section className="signing-form"><h2>Add your signature</h2><p>Only continue if you are the intended recipient and have reviewed the complete agreement above.</p><form className="stack-form" onSubmit={async e => {
        e.preventDefault(); if (busy || !consent) return; setBusy(true); setError("");
        try { const r = await request("sign", { name, consent, content_hash: document.content_hash }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setDocument(d.document); setConsentText(d.consent); }
        catch (e) { setError(e instanceof Error ? e.message : "Unable to record signature."); } finally { setBusy(false); }
      }}><label>Type your full name<input required minLength={2} maxLength={100} autoComplete="name" value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>{name && <div className="signature-preview" aria-label="Signature preview">{name}</div>}<label className="document-checkbox"><input type="checkbox" required checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} /><span>{consentText}</span></label><p>Your signature, consent, and signing time will be recorded with the document's SHA-256 hash. The sender receives this record. Signing cannot be undone through this page.</p><button disabled={busy || !consent || name.trim().length < 2}>{busy ? "Recording signature…" : "Agree & sign document"}</button></form></section>}
    </>}
  </main></div>;
}
