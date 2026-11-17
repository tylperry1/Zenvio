"use client";
import { useEffect, useState } from "react";
import { Alert, Card, Field, Skeleton } from "./ui";
import type { PlatformSocialLink } from "@/lib/platform-social";

type NetworkOption = { id: string; label: string };

export function PlatformSocialAdmin() {
  const [links, setLinks] = useState<PlatformSocialLink[] | null>(null);
  const [networks, setNetworks] = useState<NetworkOption[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/platform-social", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "Unable to load social links.");
        setLinks(d.links || []);
        setNetworks(d.networks || []);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (!links && !error) return <Skeleton rows={4} />;

  return (
    <Card
      title="Public social links"
      description="These appear on the Zenvio marketing site and contact page. Master admin only."
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {message && (
        <div role="status">
          <Alert tone="success">{message}</Alert>
        </div>
      )}
      {links && (
        <form
          className="ui-form platform-social-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            const reason = String(new FormData(e.currentTarget).get("reason") || "");
            try {
              const r = await fetch("/api/admin/platform-social", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  reason,
                  links: links.filter((l) => l.url.trim()),
                }),
              });
              const d = await r.json();
              if (!r.ok) throw Error(d.error || "Unable to save social links.");
              setLinks(d.links || []);
              setMessage("Social links saved.");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Unable to save social links.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="platform-social-rows">
            {links.map((link, index) => (
              <div className="platform-social-row" key={`${link.network}-${index}`}>
                <Field label="Network">
                  <select
                    className="ui-input"
                    disabled={busy}
                    value={link.network}
                    onChange={(e) =>
                      setLinks(
                        links.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                network: e.target.value as PlatformSocialLink["network"],
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    {networks.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="URL">
                  <input
                    className="ui-input"
                    disabled={busy}
                    value={link.url}
                    placeholder="https://…"
                    maxLength={200}
                    onChange={(e) =>
                      setLinks(
                        links.map((item, i) =>
                          i === index ? { ...item, url: e.target.value } : item,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Label (optional)">
                  <input
                    className="ui-input"
                    disabled={busy}
                    value={link.label || ""}
                    maxLength={40}
                    placeholder="Shown on public pages"
                    onChange={(e) =>
                      setLinks(
                        links.map((item, i) =>
                          i === index ? { ...item, label: e.target.value } : item,
                        ),
                      )
                    }
                  />
                </Field>
                <button
                  type="button"
                  className="ui-btn ui-btn-secondary"
                  disabled={busy}
                  onClick={() => setLinks(links.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {links.length < 8 && (
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              disabled={busy || networks.length === 0}
              onClick={() =>
                setLinks([
                  ...links,
                  {
                    network: (networks[0]?.id || "instagram") as PlatformSocialLink["network"],
                    url: "",
                  },
                ])
              }
            >
              Add social link
            </button>
          )}
          <Field label="Reason">
            <textarea
              className="ui-input"
              name="reason"
              required
              minLength={5}
              maxLength={500}
              disabled={busy}
              placeholder="Why these public links are changing"
            />
          </Field>
          <div className="premium-actions">
            <span>Empty rows are dropped on save. Links open in a new tab on public pages.</span>
            <button className="ui-btn ui-btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save social links"}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
