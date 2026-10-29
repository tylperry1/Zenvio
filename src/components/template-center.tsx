"use client";
import { useEffect, useState } from "react";
import { SuiteShell } from "./suite-shell";
import Link from "next/link";
export function TemplateCenter() {
  const [search, setSearch] = useState("");
  const [data, setData] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [contact, setContact] = useState<any>(null),
    [assign, setAssign] = useState<{ name: string; email: string }[]>([]);
  async function load() {
    const r = await fetch("/api/pdf-templates"),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d.templates);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const id = new URLSearchParams(location.search).get("contact");
    if (id)
      fetch("/api/clients?id=" + id)
        .then((r) => r.json())
        .then((d) => setContact(d.contact));
  }, []);
  async function action(v: any) {
    try {
      setError("");
      const r = await fetch("/api/pdf-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (v.action === "instantiate") {
        location.assign("/app/documents?envelope=" + d.id);
        return;
      }
      setMessage("Template updated.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <SuiteShell
      title="PDF templates"
      description="Prepare it once. Assign clients to recipient roles when you need it again."
    >
      {error && (
        <p role="alert" className="billing-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <section>
        <p>
          Create or update a template from a document’s saved field layout.
          Versions preserve documents that were already created.
        </p>
        <Link href="/app/documents">Open Documents & signatures →</Link>
      </section>
      {selected && (
        <section>
          <h2>Use {selected.name}</h2>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action({
                action: "instantiate",
                id: selected.id,
                assignments: assign,
                contact_id: contact?.id,
              });
            }}
          >
            {selected.roles.map((role: string, i: number) => (
              <div className="suite-grid" key={role}>
                <h3>{role}</h3>
                <label>
                  Name
                  <input
                    required
                    value={assign[i]?.name || ""}
                    onChange={(e) =>
                      setAssign(
                        assign.map((r, j) =>
                          j === i ? { ...r, name: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    required
                    value={assign[i]?.email || ""}
                    onChange={(e) =>
                      setAssign(
                        assign.map((r, j) =>
                          j === i ? { ...r, email: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ))}
            <button>Prepare draft for review</button>
            <button
              type="button"
              className="billing-secondary"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </form>
        </section>
      )}
      <label>
        Search templates
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <div className="suite-cards">
        {data
          .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
          .map((t) => (
            <section key={t.id}>
              <span className="billing-badge">
                Version {t.current_version}
                {t.archived ? " · Archived" : ""}
              </span>
              <h2>{t.name}</h2>
              <p>
                {t.pages.length} pages · {t.roles.join(", ")}
              </p>
              <a
                target="_blank"
                rel="noreferrer"
                href={"/api/pdf-templates?preview=" + t.id}
              >
                Preview original PDF
              </a>
              <button
                disabled={t.archived}
                onClick={() => {
                  setSelected(t);
                  setAssign(
                    t.roles.map((_: any, i: number) => ({
                      name: i === 0 ? contact?.name || "" : "",
                      email: i === 0 ? contact?.email || "" : "",
                    })),
                  );
                }}
              >
                Use template
              </button>
              <button
                className="billing-secondary"
                onClick={() => {
                  const name = prompt("New template name", t.name);
                  if (name) void action({ action: "rename", id: t.id, name });
                }}
              >
                Rename
              </button>
              <button
                className="billing-secondary"
                onClick={() => {
                  const name = prompt(
                    "Name for duplicated template",
                    t.name + " copy",
                  );
                  if (name)
                    void action({ action: "duplicate", id: t.id, name });
                }}
              >
                Duplicate
              </button>
              <button
                className="billing-secondary"
                onClick={() =>
                  action({ action: "archive", id: t.id, archived: !t.archived })
                }
              >
                {t.archived ? "Restore" : "Archive"}
              </button>
              <small>
                To edit fields, create a draft, adjust its layout, then save a
                new version of this template.
              </small>
            </section>
          ))}
      </div>
      {!data.length && (
        <section>
          <h2>Your reusable document library starts here</h2>
          <p>
            Upload a PDF in Documents, place its fields, save the draft, and
            choose Save as template.
          </p>
        </section>
      )}
    </SuiteShell>
  );
}
