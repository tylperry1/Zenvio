"use client";

import { useId, useRef, useState } from "react";
import type { StructuredAddress } from "@/lib/addresses";
import { emptyAddress, formatAddress } from "@/lib/addresses";

type Suggestion = {
  streetLine: string;
  secondary: string;
  city: string;
  state: string;
  zipcode: string;
  entries: number;
};

function suggestionLabel(s: Suggestion) {
  const secondary = s.secondary ? ` ${s.secondary}` : "";
  const more = s.entries > 1 ? ` (${s.entries} units)` : "";
  return `${s.streetLine}${secondary}, ${s.city} ${s.state} ${s.zipcode}${more}`.trim();
}

export function AddressAutocomplete({
  host,
  value,
  onChange,
  required,
  label = "Service address",
  disabled,
}: {
  host: string;
  value: StructuredAddress;
  onChange: (next: StructuredAddress) => void;
  required?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validateSeq = useRef(0);
  const latestStreet = useRef(value.street);

  function scheduleSearch(street: string, selected?: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (street.trim().length < 3) {
        setSuggestions([]);
        return;
      }
      setBusy(true);
      try {
        const params = new URLSearchParams({ host, search: street.slice(0, 32) });
        if (selected) params.set("selected", selected);
        const r = await fetch(`/api/address/autocomplete?${params}`, { cache: "no-store" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Unable to look up addresses.");
        setSuggestions(d.suggestions || []);
        setMessage(d.available === false ? d.message || "" : "");
        setOpen(true);
      } catch (e) {
        setSuggestions([]);
        setMessage(
          e instanceof Error
            ? e.message
            : "Address autocomplete is unavailable. Enter the address manually.",
        );
      } finally {
        setBusy(false);
      }
    }, 280);
  }

  async function choose(s: Suggestion) {
    if (s.entries > 1) {
      const selected = suggestionLabel(s).replace(/\s\(\d+ units\)$/, "");
      onChange({
        ...value,
        street: s.streetLine,
        formatted: formatAddress({ ...value, street: s.streetLine }),
        validated: false,
        source: "manual",
      });
      latestStreet.current = s.streetLine;
      scheduleSearch(s.streetLine, selected);
      return;
    }
    const next = {
      ...emptyAddress(),
      accessInstructions: value.accessInstructions || "",
      street: s.streetLine,
      street2: s.secondary || "",
      city: s.city,
      state: s.state,
      postalCode: s.zipcode,
      country: "US",
      source: "smarty" as const,
      validated: false,
    };
    next.formatted = formatAddress(next);
    latestStreet.current = next.street;
    onChange(next);
    setSuggestions([]);
    setOpen(false);
    const seq = ++validateSeq.current;
    try {
      const r = await fetch("/api/address/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, address: next }),
      });
      const d = await r.json();
      if (seq !== validateSeq.current) return;
      if (latestStreet.current !== next.street) return;
      if (r.ok && d.address) {
        onChange({
          ...next,
          ...d.address,
          street2: d.address.street2 || next.street2,
          accessInstructions: value.accessInstructions || next.accessInstructions || "",
        });
        if (d.message) setMessage(d.message);
      }
    } catch {
      /* keep selected suggestion */
    }
  }

  return (
    <div className="address-autocomplete">
      <label>
        Street address
        {required ? "" : <span className="optional"> optional</span>}
        <input
          value={value.street}
          disabled={disabled}
          required={required}
          autoComplete="address-line1"
          placeholder="Start typing a street address"
          maxLength={200}
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          onChange={(e) => {
            const street = e.target.value;
            latestStreet.current = street;
            validateSeq.current += 1;
            onChange({
              ...value,
              street,
              formatted: formatAddress({ ...value, street }),
              validated: false,
              source: "manual",
            });
            scheduleSearch(street);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => suggestions.length && setOpen(true)}
        />
      </label>
      {open && suggestions.length > 0 && (
        <ul id={listId} role="listbox" className="address-suggestions">
          {suggestions.map((s) => (
            <li key={suggestionLabel(s)}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void choose(s)}>
                {suggestionLabel(s)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="form-columns">
        <label>
          Apt / suite / unit
          <input
            value={value.street2}
            disabled={disabled}
            maxLength={100}
            autoComplete="address-line2"
            placeholder="Apt 4B"
            onChange={(e) => {
              validateSeq.current += 1;
              onChange({
                ...value,
                street2: e.target.value,
                formatted: formatAddress({ ...value, street2: e.target.value }),
                validated: false,
              });
            }}
          />
        </label>
        <label>
          Access instructions
          <input
            value={value.accessInstructions || ""}
            disabled={disabled}
            maxLength={1000}
            placeholder="Gate code, parking, entrance"
            onChange={(e) => {
              validateSeq.current += 1;
              onChange({ ...value, accessInstructions: e.target.value });
            }}
          />
        </label>
      </div>
      <div className="form-columns">
        <label>
          City
          <input
            value={value.city}
            disabled={disabled}
            required={required}
            maxLength={100}
            autoComplete="address-level2"
            onChange={(e) => {
              validateSeq.current += 1;
              onChange({
                ...value,
                city: e.target.value,
                formatted: formatAddress({ ...value, city: e.target.value }),
                validated: false,
                source: "manual",
              });
            }}
          />
        </label>
        <label>
          State
          <input
            value={value.state}
            disabled={disabled}
            required={required}
            maxLength={50}
            autoComplete="address-level1"
            onChange={(e) => {
              validateSeq.current += 1;
              onChange({
                ...value,
                state: e.target.value,
                formatted: formatAddress({ ...value, state: e.target.value }),
                validated: false,
                source: "manual",
              });
            }}
          />
        </label>
        <label>
          ZIP
          <input
            value={value.postalCode}
            disabled={disabled}
            required={required}
            maxLength={20}
            autoComplete="postal-code"
            onChange={(e) => {
              validateSeq.current += 1;
              onChange({
                ...value,
                postalCode: e.target.value,
                formatted: formatAddress({ ...value, postalCode: e.target.value }),
                validated: false,
                source: "manual",
              });
            }}
          />
        </label>
      </div>
      {value.formatted && (
        <small className="booking-field-help">Using: {value.formatted}</small>
      )}
      {(message || busy) && (
        <small className="booking-field-help">
          {busy ? "Looking up addresses…" : message}
        </small>
      )}
    </div>
  );
}
