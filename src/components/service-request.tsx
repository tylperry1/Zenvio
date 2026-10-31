"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, Logo } from "./icons";
import { Captcha } from "./captcha";
import { Alert, Field, LinkProblem, Skeleton } from "./ui";

type Info = { business: string; slug: string; accent: string; industry: string; categories: string[]; captchaSiteKey: string | null };

// Guest-side upload helper shared by the request form and booking forms.
export function useGuestUploads(host: string) {
  const key = useRef("");
  if (!key.current && typeof crypto !== "undefined")
    key.current = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9-]/g, "").padEnd(32, "0");
  async function upload(file: File) {
    const r = await fetch(`/api/uploads?host=${encodeURIComponent(host)}&name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Upload-Key": key.current },
      body: file,
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Upload failed.");
    return d as { id: string; filename: string };
  }
  return { key: key.current, upload };
}

export function FilePicker({
  files,
  onAdd,
  onRemove,
  max = 5,
  label = "Add photos",
}: {
  files: { id: string; filename: string }[];
  onAdd: (file: File) => Promise<void>;
  onRemove: (id: string) => void;
  max?: number;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="guest-files">
      {files.length > 0 && (
        <ul>
          {files.map((f) => (
            <li key={f.id}>
              <Icon name="paperclip" size={13} /> {f.filename}
              <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => onRemove(f.id)}>
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length < max && (
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="image" size={14} /> {busy ? "Uploading…" : label}
        </button>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 5000000) return setError("Choose a file under 5 MB.");
          setBusy(true);
          setError("");
          try {
            await onAdd(f);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed.");
          } finally {
            setBusy(false);
          }
        }}
      />
      <small className="ui-hint">JPEG, PNG, WebP or PDF, up to 5 MB each. Photo location data is removed.</small>
      {error && (
        <small className="guest-files-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function ServiceRequestForm({ host }: { host: string }) {
  const [info, setInfo] = useState<Info | null>(null),
    [missing, setMissing] = useState(false),
    [files, setFiles] = useState<{ id: string; filename: string }[]>([]),
    [captcha, setCaptcha] = useState(""),
    [attempts, setAttempts] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  const uploads = useGuestUploads(host);
  useEffect(() => {
    fetch(`/api/service-requests?host=${encodeURIComponent(host)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return setMissing(true);
        setInfo(await r.json());
      })
      .catch(() => setMissing(true));
  }, [host]);
  if (missing)
    return (
      <div className="portal-page">
        <LinkProblem title="This request page isn’t available">Check the link with the business you’re contacting.</LinkProblem>
      </div>
    );
  return (
    <div className="portal-page" style={{ "--profile-accent": info?.accent || "#365CFF" } as CSSProperties}>
      <header className="portal-top">
        <Link href="/" aria-label="Zenvio home">
          <Logo />
        </Link>
        <span>Service request</span>
      </header>
      <main className="portal-main request-main">
        {!info && <Skeleton rows={6} />}
        {info && done && (
          <section className="request-done" role="status">
            <span className="as-welcome-mark">
              <Icon name="check" size={22} />
            </span>
            <h1>Request sent</h1>
            <p>
              {info.business} has your request and will follow up by email to confirm details and timing.
            </p>
            <Link className="ui-btn ui-btn-secondary" href={`/book/${info.slug}`}>
              Book a time instead
            </Link>
          </section>
        )}
        {info && !done && (
          <>
            <section className="portal-hero">
              <p>{info.industry}</p>
              <h1>Request service from {info.business}</h1>
              <span>Tell us what’s going on and where. Photos help us quote accurately.</span>
            </section>
            <form
              className="ui-form request-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setError("");
                try {
                  const r = await fetch("/api/service-requests", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      host,
                      name: f.get("name"),
                      email: f.get("email"),
                      phone: f.get("phone"),
                      address: f.get("address"),
                      category: f.get("category"),
                      description: f.get("description"),
                      preferredTime: f.get("preferredTime"),
                      website: f.get("website"),
                      photos: files.map((x) => x.id),
                      uploadKey: uploads.key,
                      captcha,
                    }),
                  });
                  const d = await r.json();
                  if (!r.ok) throw Error(d.error);
                  setDone(true);
                  window.scrollTo({ top: 0 });
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Your request couldn’t be sent.");
                  setAttempts((n) => n + 1);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {error && <Alert tone="danger">{error}</Alert>}
              <div className="ui-form-grid">
                <Field label="Your name">
                  <input className="ui-input" name="name" required minLength={2} maxLength={100} autoComplete="name" />
                </Field>
                <Field label="Email">
                  <input className="ui-input" name="email" type="email" required autoComplete="email" />
                </Field>
                <Field label="Mobile number" hint="Optional, for day-of updates">
                  <input className="ui-input" name="phone" type="tel" maxLength={40} autoComplete="tel" />
                </Field>
                <Field label="Service needed">
                  <select className="ui-input" name="category" required defaultValue="">
                    <option value="" disabled>
                      Choose one
                    </option>
                    {info.categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Job site address">
                <input className="ui-input" name="address" required minLength={5} maxLength={300} autoComplete="street-address" />
              </Field>
              <Field label="Describe the problem" hint="What’s happening, when it started, and anything you’ve tried.">
                <textarea className="ui-input" name="description" required minLength={10} maxLength={4000} rows={5} />
              </Field>
              <Field label="Preferred time" hint="For example: weekday mornings, or after 3 PM Friday">
                <input className="ui-input" name="preferredTime" maxLength={160} />
              </Field>
              <div className="ui-field">
                <span className="ui-label">Photos</span>
                <FilePicker
                  files={files}
                  max={10}
                  onAdd={async (file) => {
                    const up = await uploads.upload(file);
                    setFiles((x) => [...x, up]);
                  }}
                  onRemove={(id) => setFiles((x) => x.filter((y) => y.id !== id))}
                />
              </div>
              <div className="honeypot" aria-hidden="true">
                <label>
                  Website
                  <input name="website" tabIndex={-1} autoComplete="off" />
                </label>
              </div>
              <Captcha siteKey={info.captchaSiteKey || ""} onToken={setCaptcha} resetKey={attempts} />
              <button className="ui-btn ui-btn-primary request-submit" disabled={busy || (!!info.captchaSiteKey && !captcha)}>
                {busy ? "Sending…" : "Send request"}
              </button>
              <p className="ui-hint">
                Your details go only to {info.business}. See our <Link href="/privacy">privacy policy</Link>.
              </p>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
