"use client";
import { Captcha, useCaptchaSiteKey } from "./captcha";
import { useMemo, useState } from "react";
import { Logo } from "./icons";
import { AddressAutocomplete } from "./address-autocomplete";
import {
  emptyAddress,
  isLocationMode,
  type LocationMode,
  type StructuredAddress,
} from "@/lib/addresses";

export function TeamBooking({
  organization,
  event,
}: {
  organization?: string;
  event?: string;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [captcha, setCaptcha] = useState(""),
    [attempts, setAttempts] = useState(0),
    [serviceAddress, setServiceAddress] = useState<StructuredAddress>(emptyAddress()),
    [accessInstructions, setAccessInstructions] = useState("");
  const captchaSiteKey = useCaptchaSiteKey();
  const locationMode = useMemo(() => {
    const modes = (data?.event?.allowed_location_modes?.length
      ? data.event.allowed_location_modes
      : [data?.event?.location_mode || "custom"]) as string[];
    const preferred = data?.event?.location_mode;
    const chosen = modes.includes(preferred) ? preferred : modes[0] || "custom";
    return (isLocationMode(chosen) ? chosen : "custom") as LocationMode;
  }, [data]);
  const needsGuestAddress =
    locationMode === "at_customer" || locationMode === "custom";
  return (
    <div className="platform-page tb-page">
      <main>
        <Logo />
        <h1>Book with our team</h1>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <section>
          <p>
            Choose a time and we'll match you with an available team
            member. You'll get a confirmation email with the details.
          </p>
          <form
            className="stack-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                if (locationMode === "at_customer" && !serviceAddress.street.trim())
                  throw Error("Enter the service address for this appointment.");
                const r = await fetch("/api/team-book", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      organization,
                      event,
                      ...Object.fromEntries(f),
                      captcha,
                      locationMode,
                      serviceAddress: needsGuestAddress ? serviceAddress : undefined,
                      accessInstructions: needsGuestAddress
                        ? accessInstructions || serviceAddress.accessInstructions || ""
                        : undefined,
                    }),
                  }),
                  d = await r.json();
                if (!r.ok) throw Error(d.error);
                setMessage(
                  "Appointment confirmed for " +
                    new Date(d.starts_at).toLocaleString() +
                    ". Check your email for details.",
                );
                setData(null);
                setServiceAddress(emptyAddress());
                setAccessInstructions("");
              } catch (e) {
                setError((e as Error).message);
                setAttempts((n) => n + 1);
              }
            }}
          >
            <label>
              Date
              <input
                type="date"
                required
                onChange={async (e) => {
                  try {
                    const r = await fetch(
                        "/api/team-book?" +
                          new URLSearchParams({
                            organization: organization!,
                            event: event!,
                            date: e.target.value,
                          }),
                      ),
                      d = await r.json();
                    if (!r.ok) throw Error(d.error);
                    setData(d);
                    setServiceAddress(emptyAddress());
                    setAccessInstructions("");
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
            </label>
            {data && (
              <>
                <h2>{data.event.title}</h2>
                <label>
                  Available time
                  <select name="starts_at" required>
                    <option value="">
                      Choose a time ·{" "}
                      {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    </option>
                    {data.slots.map((s: string) => (
                      <option key={s} value={s}>
                        {new Date(s).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Your name
                  <input name="name" required minLength={2} maxLength={100} />
                </label>
                <label>
                  Email
                  <input name="email" type="email" required maxLength={254} />
                </label>
                <label>
                  Telephone
                  <input
                    name="phone"
                    type="tel"
                    required
                    maxLength={40}
                    placeholder="+1 555 555 0100"
                  />
                </label>
                {needsGuestAddress && (
                  <>
                    <AddressAutocomplete
                      key={`${organization}-${event}-${locationMode}`}
                      host={data.host || ""}
                      value={serviceAddress}
                      onChange={setServiceAddress}
                      required={locationMode === "at_customer"}
                      label={
                        locationMode === "at_customer"
                          ? "Service address"
                          : "Meeting address"
                      }
                    />
                    <label>
                      Access instructions
                      <textarea
                        maxLength={1000}
                        rows={2}
                        value={accessInstructions}
                        onChange={(e) => setAccessInstructions(e.target.value)}
                        placeholder="Gate code, parking, suite entry…"
                      />
                    </label>
                  </>
                )}
                <Captcha siteKey={captchaSiteKey} onToken={setCaptcha} resetKey={attempts} />
                <button>Book appointment</button>
              </>
            )}
          </form>
        </section>
      </main>
    </div>
  );
}
