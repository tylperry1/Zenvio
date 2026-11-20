"use client";
import { useEffect, useState } from "react";
import { Badge, Kpi, Notice, PageHeader, Panel, Skeleton } from "./ds";

type AdminNfc = {
  enabled: boolean;
  totals: { tags: number; operations: number; succeeded: number; failed: number; batches: number };
  errorTrends: { error_code: string; total: number }[];
  platforms: Record<string, string>;
};

export function AdminNfc() {
  const [data, setData] = useState<AdminNfc | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/admin/nfc", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load NFC Studio admin.");
    setData(d);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function setEnabled(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/nfc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to update NFC Studio.");
      setNotice(enabled ? "NFC Studio enabled." : "NFC Studio disabled.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds-root">
      <PageHeader
        title="NFC Studio"
        description="Platform capability overview and operation monitoring. Tag payload contents are not exposed here."
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {!data ? (
        <Skeleton height={240} />
      ) : (
        <>
          <div className="ds-kpis">
            <Kpi label="Registered tags" value={data.totals.tags} />
            <Kpi label="Operations" value={data.totals.operations} />
            <Kpi label="Succeeded" value={data.totals.succeeded} tone="success" />
            <Kpi label="Failed" value={data.totals.failed} tone="warning" />
          </div>
          <Panel title="Availability" description="Global toggle. Workspace access still requires the Smart Cards launch feature.">
            <p>
              Status:{" "}
              <Badge tone={data.enabled ? "success" : "danger"} dot>
                {data.enabled ? "Enabled" : "Disabled"}
              </Badge>
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="ds-btn primary" disabled={busy || data.enabled} onClick={() => setEnabled(true)}>
                Enable
              </button>
              <button type="button" className="ds-btn danger" disabled={busy || !data.enabled} onClick={() => setEnabled(false)}>
                Disable
              </button>
            </div>
          </Panel>
          <Panel title="Platform notes">
            <ul>
              {Object.entries(data.platforms).map(([k, v]) => (
                <li key={k}>
                  <strong>{k}</strong>: {v}
                </li>
              ))}
            </ul>
            <Notice tone="warning">
              Physical NFC verification and App Store / Play distribution are separate from this web console. Do not claim device NFC works until
              native shells are installed and device-tested.
            </Notice>
          </Panel>
          <Panel title="Error trends (30 days)">
            {!data.errorTrends.length ? (
              <p className="ds-meta">No failed operations with error codes in the last 30 days.</p>
            ) : (
              <ul>
                {data.errorTrends.map((e) => (
                  <li key={e.error_code}>
                    <code>{e.error_code}</code> · {e.total}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Batches">
            <p>{data.totals.batches} batches recorded platform-wide.</p>
          </Panel>
        </>
      )}
    </div>
  );
}
