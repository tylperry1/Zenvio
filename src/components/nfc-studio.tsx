"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge, EmptyState, Kpi, Notice, PageHeader, Panel, Skeleton } from "./ds";
import { Icon } from "./icons";
import {
  estimateNdefBytes,
  getNfcAdapter,
  messageFromRecords,
  probeNfcCapabilities,
  recordFromEditor,
  type NdefRecord,
  type NfcCapabilities,
  type TagSnapshot,
} from "@/lib/nfc";
import { publicShareOrigin } from "@/lib/share";
import "@/app/nfc-studio.css";

type View = "overview" | "read" | "write" | "program" | "tags" | "history" | "settings";
type Card = { id: string; token: string; label: string; status: string; profile_id: string | null };
type Tag = {
  id: string;
  label: string;
  status: string;
  destination_url: string;
  smart_card_id: string | null;
  smart_card_token?: string;
  notes: string;
  last_programmed_at: string | null;
  created_at: string;
};
type Operation = {
  id: string;
  operation_type: string;
  status: string;
  payload_summary: string;
  platform: string;
  started_at: string;
  error_message: string;
  verification_status: string;
};
type Batch = {
  id: string;
  name: string;
  status: string;
  destination_url: string;
  total_tags: number;
  successful_tags: number;
  failed_tags: number;
};

const VIEWS: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "read", label: "Read NFC" },
  { id: "write", label: "Write NFC" },
  { id: "program", label: "Program Smart Card" },
  { id: "tags", label: "Tag Manager" },
  { id: "history", label: "Programming History" },
  { id: "settings", label: "Settings" },
];

async function postJson(url: string, body: Record<string, unknown>) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d;
}

export function NfcStudio() {
  const [view, setView] = useState<View>("overview");
  const [caps, setCaps] = useState<NfcCapabilities | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [totals, setTotals] = useState<{
    tags: number;
    programmed: number;
    assigned: number;
    failedTags: number;
    failedOps30d: number;
    succeededOps30d: number;
  } | null>(null);
  const [recent, setRecent] = useState<Operation[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [origin, setOrigin] = useState("https://gozenvio.com");
  const [scanState, setScanState] = useState<"idle" | "scanning" | "unsupported">("idle");
  const [lastTag, setLastTag] = useState<TagSnapshot | null>(null);
  const [writeKind, setWriteKind] = useState<"uri" | "text" | "tel" | "mailto" | "sms" | "vcard" | "smart_card">("uri");
  const [writeValue, setWriteValue] = useState("");
  const [overwriteOk, setOverwriteOk] = useState(false);
  const [lockAck, setLockAck] = useState(false);
  const [selectedCard, setSelectedCard] = useState("");
  const [batchName, setBatchName] = useState("");
  const [activeBatch, setActiveBatch] = useState<Batch | null>(null);

  const adapter = useMemo(() => getNfcAdapter(), []);

  async function refreshCaps() {
    const c = await probeNfcCapabilities();
    setCaps(c);
    setScanState(c.state === "ready" ? "idle" : "unsupported");
  }

  async function loadOverview() {
    const r = await fetch("/api/nfc/overview", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load NFC overview.");
    setTotals(d.totals);
    setRecent(d.recent || []);
  }

  async function loadTags() {
    const r = await fetch("/api/nfc/tags", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load tags.");
    setTags(d.tags || []);
  }

  async function loadHistory() {
    const r = await fetch("/api/nfc/operations?limit=80", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load history.");
    setOperations(d.operations || []);
  }

  async function loadCards() {
    const r = await fetch("/api/smart-profiles?days=7", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load Smart Cards.");
    setCards((d.cards || []).filter((c: Card) => c.status === "active"));
  }

  async function loadBatches() {
    const r = await fetch("/api/nfc/batches", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load batches.");
    setBatches(d.batches || []);
  }

  useEffect(() => {
    setOrigin(publicShareOrigin(window.location.origin));
    refreshCaps().catch((e) => setError(e.message));
    loadOverview().catch((e) => setError(e.message));
    loadCards().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setError("");
    setNotice("");
    if (view === "tags") loadTags().catch((e) => setError(e.message));
    if (view === "history") loadHistory().catch((e) => setError(e.message));
    if (view === "program") {
      loadCards().catch((e) => setError(e.message));
      loadBatches().catch(() => {});
    }
    if (view === "overview") loadOverview().catch((e) => setError(e.message));
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  async function logOperation(body: Record<string, unknown>) {
    try {
      await postJson("/api/nfc/operations", {
        platform: caps?.platform || "none",
        deviceType: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "",
        ...body,
      });
    } catch {
      /* history logging is best-effort */
    }
  }

  async function onRead() {
    setError("");
    setNotice("");
    if (!caps?.canRead) {
      setError(caps?.detail || "NFC reading is not available in this environment.");
      return;
    }
    setBusy(true);
    setScanState("scanning");
    try {
      const result = await adapter.startReading();
      if (!result.ok) {
        setError(result.errorMessage || "Read failed.");
        await logOperation({
          operationType: "read",
          status: result.errorCode === "cancelled" ? "cancelled" : "failed",
          errorCode: result.errorCode || "",
          errorMessage: result.errorMessage || "",
        });
        return;
      }
      setLastTag(result.tag || null);
      setNotice("Tag read successfully. Review the records below before opening any URL.");
      await logOperation({
        operationType: "read",
        status: "succeeded",
        payloadType: "ndef",
        records: result.tag?.message?.records || [],
        verificationStatus: "not_requested",
      });
      await loadOverview().catch(() => {});
    } finally {
      setBusy(false);
      setScanState(caps?.state === "ready" ? "idle" : "unsupported");
    }
  }

  function buildRecords(forceSmartCard = false): NdefRecord[] {
    if (forceSmartCard || writeKind === "smart_card") {
      const card = cards.find((c) => c.id === selectedCard);
      if (!card) throw new Error("Select a Smart Card to program.");
      return [recordFromEditor("smart_card", `${origin}/c/${card.token}`)];
    }
    return [recordFromEditor(writeKind, writeValue)];
  }

  async function onWrite(kind: "write" | "program_smart_card" = "write") {
    setError("");
    setNotice("");
    if (!caps?.canWrite) {
      setError(caps?.detail || "NFC writing is not available in this environment.");
      return;
    }
    let records: NdefRecord[];
    try {
      records = buildRecords(kind === "program_smart_card");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid payload.");
      return;
    }
    if (!overwriteOk) {
      setError("Confirm that you intend to overwrite existing tag contents before writing.");
      return;
    }
    const message = messageFromRecords(records);
    setBusy(true);
    setScanState("scanning");
    try {
      const result = await adapter.writeNdef({ message, overwriteConfirmed: true });
      if (!result.ok) {
        setError(result.errorMessage || "Write failed.");
        await logOperation({
          operationType: kind,
          status: result.errorCode === "cancelled" ? "cancelled" : "failed",
          errorCode: result.errorCode || "",
          errorMessage: result.errorMessage || "",
          records,
        });
        return;
      }
      if (!result.verified) {
        setNotice(result.errorMessage || "Write finished but verification did not confirm a match.");
        await logOperation({
          operationType: kind,
          status: "unverified",
          verificationStatus: "mismatched",
          records,
          errorMessage: result.errorMessage || "",
        });
      } else {
        setNotice("Write verified with read-after-write.");
        await logOperation({
          operationType: kind,
          status: "succeeded",
          verificationStatus: "matched",
          records,
          payloadType: records[0]?.type || "",
        });
      }
      setLastTag(result.tag || { ndefSupported: true, message: result.readBack });
      const destination = records.find((r) => r.type === "uri")?.value || "";
      if (destination) {
        await postJson("/api/nfc/tags", {
          action: "record-program",
          label: kind === "program_smart_card" ? "Smart Card tag" : "Written tag",
          destinationUrl: destination,
          smartCardId: kind === "program_smart_card" ? selectedCard || null : null,
          verified: Boolean(result.verified),
          tagType: result.tag?.technology || "",
          capacityBytes: result.tag?.capacityBytes,
        });
        if (activeBatch && result.verified) {
          const op = await postJson("/api/nfc/operations", {
            operationType: "batch_item",
            status: "succeeded",
            platform: caps?.platform || "none",
            records,
            verificationStatus: "matched",
          });
          const updated = await postJson("/api/nfc/batches", {
            action: "record-item",
            batchId: activeBatch.id,
            status: "succeeded",
            operationId: op.operation?.id,
          });
          setActiveBatch(updated.batch);
        }
      }
      await loadOverview().catch(() => {});
      await loadTags().catch(() => {});
    } finally {
      setBusy(false);
      setScanState(caps?.state === "ready" ? "idle" : "unsupported");
    }
  }

  async function onLock() {
    setError("");
    if (!caps?.canMakeReadOnly) {
      setError("Permanent locking is not available in this environment.");
      return;
    }
    if (!lockAck) {
      setError("Confirm that you understand locking is irreversible on supported tags.");
      return;
    }
    setBusy(true);
    setScanState("scanning");
    try {
      const result = await adapter.makeReadOnly();
      if (!result.ok) {
        setError(result.errorMessage || "Lock failed.");
        await logOperation({ operationType: "lock", status: "failed", errorCode: result.errorCode || "", errorMessage: result.errorMessage || "" });
        return;
      }
      setNotice("Tag reported as permanently read-only by the device.");
      await logOperation({ operationType: "lock", status: "succeeded" });
    } finally {
      setBusy(false);
      setScanState(caps?.state === "ready" ? "idle" : "unsupported");
    }
  }

  async function startBatch() {
    setError("");
    const card = cards.find((c) => c.id === selectedCard);
    if (!card) return setError("Select a Smart Card for the batch.");
    if (!batchName.trim()) return setError("Name this batch.");
    const destinationUrl = `${origin}/c/${card.token}`;
    const d = await postJson("/api/nfc/batches", {
      action: "create",
      name: batchName.trim(),
      smartCardId: card.id,
      destinationUrl,
    });
    setActiveBatch(d.batch);
    setWriteKind("smart_card");
    setNotice("Batch started. Program one tag at a time, then remove it before the next.");
    await loadBatches();
  }

  const ready = caps?.state === "ready";
  const estimated = (() => {
    try {
      return estimateNdefBytes(buildRecords());
    } catch {
      return null;
    }
  })();

  return (
    <div className="ds-root platform-page nfc-studio">
      <PageHeader
        eyebrow="Smart Cards"
        title="NFC Studio"
        description="Read, write, and program Zenvio Smart Card tags with verified NDEF operations. Device actions only enable when this environment can actually perform them."
        actions={
          <Link className="ds-btn ghost sm" href="/app/smart-cards">
            Back to Smart Cards
          </Link>
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <nav className="nfc-studio-nav" aria-label="NFC Studio">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={view === v.id ? "active" : ""} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>

      {view === "overview" && (
        <>
          <div className="ds-kpis">
            <Kpi label="Registered tags" value={totals ? totals.tags : <Skeleton width="40%" height={28} />} icon="nfc" />
            <Kpi label="Programmed" value={totals ? totals.programmed : <Skeleton width="40%" height={28} />} icon="check" />
            <Kpi label="Assigned to cards" value={totals ? totals.assigned : <Skeleton width="40%" height={28} />} icon="link" />
            <Kpi label="Failed ops (30d)" value={totals ? totals.failedOps30d : <Skeleton width="40%" height={28} />} icon="alert" tone="warning" />
          </div>
          <div className="nfc-grid-2">
            <Panel title="Device capability" description="Reported by this browser or native shell — never assumed.">
              {!caps ? (
                <Skeleton height={72} />
              ) : (
                <>
                  <p>
                    <Badge tone={ready ? "success" : "warning"} dot>
                      {caps.state.replaceAll("_", " ")}
                    </Badge>{" "}
                    <span className="ds-meta">platform: {caps.platform}</span>
                  </p>
                  <p>{caps.detail}</p>
                  <p className="ds-meta">
                    Read {caps.canRead ? "yes" : "no"} · Write {caps.canWrite ? "yes" : "no"} · Lock{" "}
                    {caps.canMakeReadOnly ? "yes" : "no"}
                  </p>
                </>
              )}
            </Panel>
            <Panel title="Quick actions">
              <div className="nfc-actions">
                <button type="button" className="ds-btn primary" disabled={!ready || busy} onClick={() => { setView("read"); }}>
                  Read a Tag
                </button>
                <button type="button" className="ds-btn" disabled={!ready || busy} onClick={() => setView("write")}>
                  Write a Tag
                </button>
                <button type="button" className="ds-btn" disabled={!ready || busy} onClick={() => setView("program")}>
                  Program a Smart Card
                </button>
                <button type="button" className="ds-btn ghost" onClick={() => setView("tags")}>
                  Manage Tags
                </button>
              </div>
            </Panel>
          </div>
          <Panel title="Recent activity" flush>
            {!recent.length ? (
              <EmptyState title="No NFC operations yet">Successful and failed device operations will appear here.</EmptyState>
            ) : (
              <div className="nfc-table-wrap">
                <table className="nfc-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((op) => (
                      <tr key={op.id}>
                        <td>{new Date(op.started_at).toLocaleString()}</td>
                        <td>{op.operation_type}</td>
                        <td>
                          <Badge tone={op.status === "succeeded" ? "success" : op.status === "failed" ? "danger" : "neutral"}>
                            {op.status}
                          </Badge>
                        </td>
                        <td>{op.payload_summary || op.error_message || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {(view === "read" || view === "write" || view === "program") && (
        <Panel
          title={view === "read" ? "Read NFC" : view === "write" ? "Write NFC" : "Program Smart Card"}
          description={
            view === "read"
              ? "Hold a compatible NDEF tag near the phone after you start scanning."
              : "Review the exact payload, confirm overwrite, then verify with read-after-write."
          }
        >
          <div className="nfc-scan" data-state={scanState} aria-live="polite">
            <div className="nfc-pulse" aria-hidden="true">
              <Icon name="nfc" size={34} />
            </div>
            <div>
              <strong>{scanState === "scanning" ? "Hold the tag near your phone…" : ready ? "Ready when you are" : "NFC unavailable here"}</strong>
              <p>{caps?.detail}</p>
            </div>
            <div className="nfc-actions">
              {view === "read" && (
                <button type="button" className="ds-btn primary" disabled={!ready || busy} onClick={onRead}>
                  {busy ? "Scanning…" : "Start Scanning"}
                </button>
              )}
              {view !== "read" && (
                <button
                  type="button"
                  className="ds-btn primary"
                  disabled={!ready || busy}
                  onClick={() => onWrite(view === "program" ? "program_smart_card" : "write")}
                >
                  {busy ? "Waiting for tag…" : view === "program" ? "Program NFC Card" : "Write NDEF"}
                </button>
              )}
              <button type="button" className="ds-btn ghost" disabled={!busy} onClick={() => adapter.cancelOperation()}>
                Cancel
              </button>
            </div>
          </div>

          {view !== "read" && (
            <div className="nfc-grid-2" style={{ marginTop: 16 }}>
              <label className="ds-field">
                Record type
                <select className="ds-select" value={writeKind} onChange={(e) => setWriteKind(e.target.value as typeof writeKind)}>
                  <option value="uri">Website URL</option>
                  <option value="text">Plain text</option>
                  <option value="tel">Telephone</option>
                  <option value="mailto">Email</option>
                  <option value="sms">SMS</option>
                  <option value="vcard">vCard / contact</option>
                  <option value="smart_card">Zenvio Smart Card URL</option>
                </select>
              </label>
              {writeKind === "smart_card" || view === "program" ? (
                <label className="ds-field">
                  Smart Card
                  <select
                    className="ds-select"
                    value={selectedCard}
                    onChange={(e) => {
                      setSelectedCard(e.target.value);
                      setWriteKind("smart_card");
                    }}
                  >
                    <option value="">Select a card…</option>
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {(c.label || "Card") + ` · /c/${c.token.slice(0, 8)}…`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="ds-field">
                  Value
                  <input value={writeValue} onChange={(e) => setWriteValue(e.target.value)} placeholder="https://… or text" />
                </label>
              )}
            </div>
          )}

          {view !== "read" && (
            <div style={{ marginTop: 12 }}>
              <label className="ds-field" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" checked={overwriteOk} onChange={(e) => setOverwriteOk(e.target.checked)} />
                <span>I confirm this write may overwrite existing NDEF data on the tag.</span>
              </label>
              {estimated != null && <p className="ds-meta">Estimated payload: {estimated} bytes</p>}
              {writeKind === "smart_card" && selectedCard && (
                <Notice tone="info">
                  Physical tag will store a stable redirect: <code>{origin}/c/{cards.find((c) => c.id === selectedCard)?.token}</code>. Profile
                  content can change later without rewriting the tag.
                </Notice>
              )}
            </div>
          )}

          {lastTag?.message && (
            <div style={{ marginTop: 16 }}>
              <h3>Last tag contents</h3>
              <p className="ds-meta">
                NDEF {lastTag.ndefSupported ? "yes" : "no"}
                {lastTag.writable != null ? ` · writable ${lastTag.writable ? "yes" : "no"}` : ""}
                {lastTag.capacityBytes != null ? ` · capacity ${lastTag.capacityBytes}B` : ""}
                {lastTag.usedBytes != null ? ` · used ${lastTag.usedBytes}B` : ""}
              </p>
              <div className="nfc-record-list">
                {lastTag.message.records.map((r, i) => (
                  <article key={i} className="nfc-record">
                    <strong>
                      {r.label} <Badge tone="neutral">{r.type}</Badge>
                    </strong>
                    <p>{r.value || "—"}</p>
                    {r.type === "uri" && r.value && (
                      <div className="nfc-actions" style={{ marginTop: 8 }}>
                        <button type="button" className="ds-btn ghost sm" onClick={() => navigator.clipboard.writeText(r.value)}>
                          Copy URL
                        </button>
                        <button
                          type="button"
                          className="ds-btn ghost sm"
                          onClick={() => {
                            if (window.confirm(`Open this scanned URL?\n\n${r.value}`)) window.open(r.value, "_blank", "noopener,noreferrer");
                          }}
                        >
                          Open URL…
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <div className="nfc-actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="ds-btn"
                  onClick={async () => {
                    await postJson("/api/nfc/tags", {
                      action: "register",
                      label: "Scanned tag",
                      destinationUrl: lastTag.message?.records.find((r) => r.type === "uri")?.value || "",
                      tagType: lastTag.technology || "",
                      capacityBytes: lastTag.capacityBytes,
                    });
                    setNotice("Tag saved to Tag Manager.");
                    setView("tags");
                  }}
                >
                  Save to Tag Manager
                </button>
              </div>
            </div>
          )}
        </Panel>
      )}

      {view === "program" && (
        <Panel title="Batch programming" description="Sequential only — one tag at a time, with per-tag verification.">
          <div className="nfc-grid-2">
            <label className="ds-field">
              Batch name
              <input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="Front-desk cards · March" />
            </label>
            <div className="nfc-actions" style={{ alignItems: "end" }}>
              <button type="button" className="ds-btn" disabled={busy} onClick={() => startBatch().catch((e) => setError(e.message))}>
                Create batch
              </button>
              {activeBatch && (
                <button
                  type="button"
                  className="ds-btn ghost"
                  onClick={() =>
                    postJson("/api/nfc/batches", { action: "complete", batchId: activeBatch.id })
                      .then((d) => {
                        setActiveBatch(d.batch);
                        setNotice("Batch closed.");
                        return loadBatches();
                      })
                      .catch((e) => setError(e.message))
                  }
                >
                  Complete batch
                </button>
              )}
            </div>
          </div>
          {activeBatch && (
            <Notice tone="info">
              Active batch <strong>{activeBatch.name}</strong>: {activeBatch.successful_tags} ok · {activeBatch.failed_tags} failed ·{" "}
              {activeBatch.total_tags} total. Remove each tag before presenting the next.
            </Notice>
          )}
          {!!batches.length && (
            <div className="nfc-table-wrap" style={{ marginTop: 12 }}>
              <table className="nfc-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.slice(0, 8).map((b) => (
                    <tr key={b.id}>
                      <td>{b.name}</td>
                      <td>{b.status}</td>
                      <td>
                        {b.successful_tags}/{b.total_tags} ok · {b.failed_tags} failed
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {view === "tags" && (
        <Panel title="Tag Manager" flush>
          {!tags.length ? (
            <EmptyState title="No registered tags">Save a scanned tag or complete a verified write to register one.</EmptyState>
          ) : (
            <div className="nfc-table-wrap">
              <table className="nfc-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Status</th>
                    <th>Destination</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {tags.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.label || "Untitled"}</strong>
                        {t.smart_card_token && <div className="ds-meta">card /c/{t.smart_card_token.slice(0, 10)}…</div>}
                      </td>
                      <td>
                        <Badge tone={t.status === "failed" ? "danger" : t.status === "programmed" || t.status === "assigned" ? "success" : "neutral"}>
                          {t.status}
                        </Badge>
                      </td>
                      <td>
                        <code>{t.destination_url || "—"}</code>
                      </td>
                      <td>{new Date(t.last_programmed_at || t.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {view === "history" && (
        <Panel title="Programming history" flush>
          {!operations.length ? (
            <EmptyState title="No history yet">Device operations are recorded after each read, write, program, or lock attempt.</EmptyState>
          ) : (
            <div className="nfc-table-wrap">
              <table className="nfc-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Operation</th>
                    <th>Platform</th>
                    <th>Verification</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((op) => (
                    <tr key={op.id}>
                      <td>{new Date(op.started_at).toLocaleString()}</td>
                      <td>
                        {op.operation_type}
                        <div className="ds-meta">{op.payload_summary || op.error_message}</div>
                      </td>
                      <td>{op.platform}</td>
                      <td>{op.verification_status}</td>
                      <td>{op.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {view === "settings" && (
        <div className="nfc-grid-2">
          <Panel title="Environment" description="Honest capability reporting for this session.">
            <button type="button" className="ds-btn" onClick={() => refreshCaps().catch((e) => setError(e.message))}>
              Re-check capabilities
            </button>
            {caps && (
              <ul>
                <li>State: {caps.state}</li>
                <li>Platform: {caps.platform}</li>
                <li>{caps.detail}</li>
              </ul>
            )}
            <Notice tone="warning">
              iPhone Safari cannot use Core NFC. Use the Zenvio Capacitor NFC shell with the Near Field Communication Tag Reading entitlement for
              iOS read/write.
            </Notice>
          </Panel>
          <Panel title="Permanent lock" description="Irreversible on tags that support it. Never automatic.">
            <label className="ds-field" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={lockAck} onChange={(e) => setLockAck(e.target.checked)} />
              <span>I understand Make Read-Only may permanently prevent future writes to this physical tag.</span>
            </label>
            <button type="button" className="ds-btn danger" disabled={!ready || !caps?.canMakeReadOnly || busy || !lockAck} onClick={onLock}>
              Make Read-Only…
            </button>
          </Panel>
        </div>
      )}
    </div>
  );
}
