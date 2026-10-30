"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SuiteShell } from "./suite-shell";
import { Icon } from "./icons";
import { Modal } from "./modal";
import { Alert, Badge, Card, EmptyState, Field, Skeleton, Toggle, useToast } from "./ui";

type Template = {
  id: string;
  name: string;
  current_version: number;
  archived: boolean;
  pages: unknown[];
  roles: string[];
};

export function TemplateCenter() {
  const [search, setSearch] = useState(""),
    [showArchived, setShowArchived] = useState(false),
    [data, setData] = useState<Template[] | null>(null),
    [loadError, setLoadError] = useState(""),
    [selected, setSelected] = useState<Template | null>(null),
    [naming, setNaming] = useState<{ template: Template; mode: "rename" | "duplicate" } | null>(null),
    [contact, setContact] = useState<{ id: string; name: string; email: string } | null>(null),
    [assign, setAssign] = useState<{ name: string; email: string }[]>([]),
    [busy, setBusy] = useState(false);
  const toast = useToast();
  async function load() {
    const r = await fetch("/api/pdf-templates", { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d.templates);
  }
  useEffect(() => {
    load().catch((e) => setLoadError(e.message));
    const id = new URLSearchParams(location.search).get("contact");
    if (id)
      fetch("/api/clients?id=" + id)
        .then((r) => r.json())
        .then((d) => setContact(d.contact))
        .catch(() => {});
  }, []);
  async function action(v: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/pdf-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (v.action === "instantiate") {
        location.assign("/app/documents?envelope=" + d.id);
        return true;
      }
      toast.show(success);
      await load();
      return true;
    } catch (e) {
      toast.show((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function use(t: Template) {
    setSelected(t);
    setAssign(
      t.roles.map((_, i) => ({
        name: i === 0 ? contact?.name || "" : "",
        email: i === 0 ? contact?.email || "" : "",
      })),
    );
  }
  const visible = (data || []).filter(
    (t) => (showArchived || !t.archived) && t.name.toLowerCase().includes(search.toLowerCase()),
  );
  const archivedCount = (data || []).filter((t) => t.archived).length;
  return (
    <SuiteShell
      title="PDF templates"
      description="Set up a document’s fields once, then send it to new clients in a couple of clicks."
      actions={
        <Link className="ui-btn ui-btn-secondary" href="/app/documents">
          <Icon name="file" size={15} /> Go to Documents
        </Link>
      }
    >
      {contact && (
        <Alert tone="info" title={`Preparing a document for ${contact.name}`}>
          Choose a template — {contact.name} is filled in as the first signer.
        </Alert>
      )}
      {loadError && <Alert tone="danger" title="We couldn’t load templates">{loadError}</Alert>}
      {!data && !loadError && (
        <Card>
          <Skeleton rows={3} />
        </Card>
      )}
      {data && !data.length && (
        <Card>
          <EmptyState
            icon="layers"
            title="Your template library is empty"
            action={
              <Link className="ui-btn ui-btn-primary" href="/app/documents">
                Create a document
              </Link>
            }
          >
            Upload a PDF in Documents, place its signature and form fields, then choose “Save as template”. New
            versions never change documents you’ve already sent.
          </EmptyState>
        </Card>
      )}
      {data && data.length > 0 && (
        <>
          <div className="tpl-toolbar">
            <label className="client-search">
              <Icon name="search" size={16} />
              <input
                aria-label="Search templates"
                placeholder="Search templates"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {archivedCount > 0 && (
              <span className="tpl-archived">
                <Toggle label="Show archived templates" checked={showArchived} onChange={setShowArchived} />
                Show archived ({archivedCount})
              </span>
            )}
          </div>
          {!visible.length ? (
            <Card>
              <EmptyState icon="search" title="No templates match">
                Try a different name.
              </EmptyState>
            </Card>
          ) : (
            <div className="tpl-grid">
              {visible.map((t) => (
                <article key={t.id} className={`tpl-card${t.archived ? " archived" : ""}`}>
                  <a
                    className="tpl-thumb"
                    href={"/api/pdf-templates?preview=" + t.id}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Preview ${t.name}`}
                  >
                    <Icon name="file" size={28} />
                    <span>
                      {t.pages.length} page{t.pages.length === 1 ? "" : "s"}
                    </span>
                  </a>
                  <div className="tpl-body">
                    <div className="tpl-title">
                      <h3>{t.name}</h3>
                      <Badge tone={t.archived ? "neutral" : "info"}>
                        {t.archived ? "Archived" : `v${t.current_version}`}
                      </Badge>
                    </div>
                    <div className="ui-chips">
                      {t.roles.map((r) => (
                        <Badge key={r}>{r}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="tpl-actions">
                    <button className="ui-btn ui-btn-primary ui-btn-sm" disabled={t.archived} onClick={() => use(t)}>
                      Use template
                    </button>
                    <button
                      className="ui-btn ui-btn-ghost ui-btn-sm"
                      onClick={() => setNaming({ template: t, mode: "rename" })}
                    >
                      Rename
                    </button>
                    <button
                      className="ui-btn ui-btn-ghost ui-btn-sm"
                      onClick={() => setNaming({ template: t, mode: "duplicate" })}
                    >
                      Duplicate
                    </button>
                    <button
                      className="ui-btn ui-btn-ghost ui-btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void action(
                          { action: "archive", id: t.id, archived: !t.archived },
                          t.archived ? "Template restored." : "Template archived.",
                        )
                      }
                    >
                      {t.archived ? "Restore" : "Archive"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="lc-muted tpl-note">
            To change a template’s fields, use it to create a draft, adjust the layout, and save a new version.
          </p>
        </>
      )}

      {selected && (
        <Modal title={`New document from ${selected.name}`} onClose={() => !busy && setSelected(null)}>
          <form
            className="ui-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                { action: "instantiate", id: selected.id, assignments: assign, contact_id: contact?.id },
                "Draft created.",
              );
            }}
          >
            <p className="lc-muted">
              Add who signs in each role. You’ll review the draft before anything is sent.
            </p>
            {selected.roles.map((role, i) => (
              <fieldset key={role} className="tpl-role">
                <legend>{role}</legend>
                <div className="ui-form-grid">
                  <Field label="Name">
                    <input
                      required
                      value={assign[i]?.name || ""}
                      onChange={(e) => setAssign(assign.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      type="email"
                      required
                      value={assign[i]?.email || ""}
                      onChange={(e) => setAssign(assign.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))}
                    />
                  </Field>
                </div>
              </fieldset>
            ))}
            <div className="ui-modal-actions">
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setSelected(null)}>
                Cancel
              </button>
              <button className="ui-btn ui-btn-primary" disabled={busy}>
                {busy ? "Preparing…" : "Prepare draft for review"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {naming && (
        <Modal
          title={naming.mode === "rename" ? "Rename template" : "Duplicate template"}
          onClose={() => !busy && setNaming(null)}
        >
          <form
            className="ui-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name"));
              const ok = await action(
                { action: naming.mode, id: naming.template.id, name },
                naming.mode === "rename" ? "Template renamed." : "Template duplicated.",
              );
              if (ok) setNaming(null);
            }}
          >
            <Field label="Template name">
              <input
                name="name"
                required
                autoFocus
                maxLength={120}
                defaultValue={naming.mode === "rename" ? naming.template.name : `${naming.template.name} copy`}
              />
            </Field>
            <div className="ui-modal-actions">
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setNaming(null)}>
                Cancel
              </button>
              <button className="ui-btn ui-btn-primary" disabled={busy}>
                {naming.mode === "rename" ? "Save name" : "Duplicate"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {toast.node}
    </SuiteShell>
  );
}
