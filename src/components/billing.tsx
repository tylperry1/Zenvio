"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export function Billing() {
  const [data, setData] = useState<any>(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/billing")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
      })
      .catch((e) => setMessage(e.message));
  }, []);
  return (
    <div className="platform-page">
      <main style={{ maxWidth: 1000, margin: "auto", padding: 32 }}>
        <Link href="/app">← Workspace</Link>
        <h1>Your plan & billing</h1>
        <p>
          {data
            ? `Current plan: ${data.subscription.plan} · ${data.subscription.status}`
            : "Loading billing…"}
        </p>
        {message && <p role="status">{message}</p>}
        <button
          onClick={async () => {
            try {
              const r = await fetch("/api/billing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "portal" }),
              });
              const d = await r.json();
              if (!r.ok) throw Error(d.error);
              window.location.assign(d.url);
            } catch (e) {
              setMessage(
                e instanceof Error ? e.message : "Unable to open billing.",
              );
            }
          }}
        >
          Manage invoices & payment method
        </button>
        <p>
          Paid checkout is being prepared. You won’t be charged from this page.
        </p>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {data?.plans.map((p: any) => (
            <section
              key={p.id}
              style={{
                padding: 24,
                border: "1px solid #dce5ff",
                borderRadius: 16,
                flex: "1 1 180px",
              }}
            >
              <h2>{p.name}</h2>
              <p>${(p.monthly / 100).toFixed(2)} / month</p>
              <p>${(p.annual / 100).toFixed(2)} / year</p>
              {p.seats > 1 && <p>Per host · {p.seats}-seat minimum</p>}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
