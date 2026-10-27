"use client";
import { useEffect, useRef, useState } from "react";
import { PdfPages } from "./pdf-pages";
import { Logo } from "./icons";
import type { Field, Recipient } from "@/lib/envelopes";
export function EnvelopeSign() {
  const token = useRef(""),
    [data, setData] = useState<any>(null),
    [bytes, setBytes] = useState<Uint8Array | null>(null),
    [name, setName] = useState(""),
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [declined, setDeclined] = useState(false);
  async function request(action: string, extra: any = {}) {
    return fetch("/api/envelope-sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token: token.current, ...extra }),
      cache: "no-store",
    });
  }
  useEffect(() => {
    token.current ||=
      new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    window.history.replaceState(null, "", window.location.pathname);
    let active = true;
    if (!token.current) {
      setError("Open the complete private link sent to you.");
      return;
    }
    (async () => {
      try {
        const r = await request("read"),
          d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (!active) return;
        setData(d);
        const p = await request("pdf");
        if (!p.ok) throw Error("Unable to open PDF.");
        const b = new Uint8Array(await p.arrayBuffer());
        if (active) setBytes(b);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  async function download(action: string) {
    setBusy(true);
    setError("");
    try {
      const r = await request(action);
      if (!r.ok) throw Error((await r.json()).error);
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download =
        action === "pdf" ? "original-agreement.pdf" : "signed-agreement.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const e = data?.envelope,
    r: Recipient | undefined = data?.recipient,
    fields: Field[] = e?.fields || [],
    signed = r?.status === "signed";
  return (
    <div className="platform-page envelope-sign-page">
      <header className="envelope-sign-header">
        <Logo />
        <span>Secure document review</span>
        {e && (
          <button
            className="billing-secondary"
            disabled={busy}
            onClick={() => download("pdf")}
          >
            Download original
          </button>
        )}
      </header>
      <main>
        {error && (
          <p className="billing-error" role="alert">
            {error}
          </p>
        )}
        {declined ? (
          <section className="envelope-card">
            <h1>Document declined</h1>
            <p>
              Your response is recorded. Contact the sender if you need changes.
            </p>
          </section>
        ) : !e ? (
          !error && <p>Opening your agreement…</p>
        ) : (
          <>
            <div className="envelope-heading">
              <div>
                <span className="billing-eyebrow">
                  {signed ? "YOUR SIGNATURE IS RECORDED" : "REVIEW & SIGN"}
                </span>
                <h1>{e.title}</h1>
                <p>
                  From {e.sender_name} · Prepared for {r?.name}
                </p>
                {e.message && <p>{e.message}</p>}
              </div>
              <span className="billing-badge">
                {e.status === "completed"
                  ? "Completed"
                  : signed
                    ? "Waiting for other recipients"
                    : fields.length + " assigned fields"}
              </span>
            </div>
            <div className="envelope-editor signer-editor">
              <aside className="envelope-tools">
                <h2>{signed ? "Thank you for signing" : "Your signature"}</h2>
                <p>
                  {r?.name}
                  <br />
                  {r?.email}
                </p>
                {signed ? (
                  <>
                    <p>Signed {new Date(r!.signed_at!).toLocaleString()}.</p>
                    {e.status === "completed" ? (
                      <button
                        disabled={busy}
                        onClick={() => download("download")}
                      >
                        Download completed PDF
                      </button>
                    ) : (
                      <p>
                        The final PDF will be available here when everyone has
                        signed. Keep your original link to return.
                      </p>
                    )}
                    <button
                      disabled={busy}
                      className="billing-secondary"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const r = await request("read"),
                            d = await r.json();
                          if (!r.ok) throw Error(d.error);
                          setData(d);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Refresh status
                    </button>
                  </>
                ) : (
                  <form
                    className="stack-form"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (busy || !consent) return;
                      setBusy(true);
                      setError("");
                      try {
                        const res = await request("sign", {
                            name,
                            answers,
                            consent,
                            content_hash: e.content_hash,
                          }),
                          d = await res.json();
                        if (!res.ok) throw Error(d.error);
                        setData(d);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <label>
                      Full name for your signature
                      <input
                        required
                        minLength={2}
                        maxLength={100}
                        value={name}
                        disabled={busy}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                      />
                    </label>
                    <div className="signature-preview">
                      {name || "Your signature"}
                    </div>
                    <small>
                      Your name and initials fill the assigned signature fields.
                      Dates are recorded automatically in UTC.
                    </small>
                    {fields
                      .filter((f) => f.type === "text")
                      .map((f) => (
                        <label key={f.id}>
                          {f.label}
                          {f.required ? " *" : " (optional)"}
                          <input
                            required={f.required}
                            maxLength={150}
                            value={answers[f.id] || ""}
                            onChange={(e) =>
                              setAnswers({ ...answers, [f.id]: e.target.value })
                            }
                          />
                        </label>
                      ))}
                    <label className="document-checkbox">
                      <input
                        type="checkbox"
                        required
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <span>{data.consent}</span>
                    </label>
                    <p>
                      Review every page before signing. Your signature and
                      responses will be shared with the sender and included in
                      the completed PDF available to every recipient.
                    </p>
                    <button disabled={busy || !consent || !bytes}>
                      {busy ? "Recording…" : "Finish & sign"}
                    </button>
                    <button
                      type="button"
                      className="billing-secondary"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !confirm(
                            "Decline this document? Signing will stop for every recipient.",
                          )
                        )
                          return;
                        setBusy(true);
                        try {
                          const r = await request("decline"),
                            d = await r.json();
                          if (!r.ok) throw Error(d.error);
                          setDeclined(true);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Decline to sign
                    </button>
                  </form>
                )}
                <small>
                  Identity method: possession of a private link and a
                  self-attested name. Email and government identity are not
                  independently verified.
                </small>
              </aside>
              <PdfPages
                bytes={bytes}
                pages={e.pages}
                overlay={(page) =>
                  fields
                    .filter((f) => f.page === page)
                    .map((f) => (
                      <div
                        className={
                          "pdf-field signing-field " + (signed ? "filled" : "")
                        }
                        key={f.id}
                        style={{
                          left: f.x * 100 + "%",
                          top: f.y * 100 + "%",
                          width: f.width * 100 + "%",
                          height: f.height * 100 + "%",
                        }}
                      >
                        {f.type === "signature"
                          ? r?.signature_name || name || "Signature"
                          : f.type === "initials"
                            ? (r?.signature_name || name)
                                .split(/\s+/)
                                .map((s) => s[0])
                                .join("") || "Initials"
                            : f.type === "date"
                              ? signed
                                ? new Date(r!.signed_at!)
                                    .toISOString()
                                    .slice(0, 10)
                                : "Date signed"
                              : r?.answers?.[f.id] || answers[f.id] || f.label}
                      </div>
                    ))
                }
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
