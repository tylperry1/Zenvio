"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo, Icon } from "@/components/icons";
import { DEMO_KEY, readDemo } from "@/lib/demo";
export default function Page() {
  const [token, setToken] = useState(""),
    [demo, setDemo] = useState(false),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    setToken(params.get("token") || "");
    setDemo(params.get("demo") === "1");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  return (
    <main className="center-page cancellation-page">
      <Link href="/">
        <Logo />
      </Link>
      <span className="empty-icon">
        <Icon name={done ? "check" : "calendar"} size={30} />
      </span>
      <h1>
        {done ? "A little change of plans." : "Need to free up this time?"}
      </h1>
      <p>
        {done
          ? "Your appointment has been cancelled. The time is available again."
          : "Cancel your appointment below. This action cannot be undone."}
      </p>
      {demo && (
        <p className="notice">
          This changes only the demo appointment saved in this browser.
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!done && (
        <button
          className="button primary"
          disabled={busy || !token}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              if (demo) {
                const data = readDemo();
                const match = data.bookings.find(
                  (b) =>
                    (b as typeof b & { cancel_token?: string }).cancel_token ===
                    token,
                );
                if (!match || new Date(match.starts_at) <= new Date())
                  throw new Error(
                    "This demo appointment could not be found or has already started.",
                  );
                match.status = "cancelled";
                localStorage.setItem(DEMO_KEY, JSON.stringify(data));
              } else {
                const r = await fetch("/api/cancel", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ token }),
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d.error);
              }
              setDone(true);
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Unable to cancel. Please try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Cancelling…" : "Yes, cancel appointment"}
        </button>
      )}
      {!token && !done && (
        <p>
          Open the private cancellation link saved with your booking
          confirmation.
        </p>
      )}
      <Link href={demo ? "/demo" : "/"} className="inline-link">
        Back to {demo ? "demo workspace" : "Zenvio"}
        <Icon name="arrow" size={16} />
      </Link>
    </main>
  );
}
