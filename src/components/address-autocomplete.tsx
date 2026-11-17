"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  const [query, setQuery] = useState(value.formatted || value.street || "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value.formatted || [value.street, value.city, value.state, value.postalCode].filter(Boolean).join(", "));
  }, [value.formatted, value.street, value.city, value.state, value.postalCode]);

  function scheduleSearch(next: string, selected?: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (next.trim().length < 3) {
        setSuggestions([]);
        return;
      }
      setBusy(true);
      try {
        const params = new URLSearchParams({ host, search: next.slice(0, 32) });
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
      setQuery(selected);
      scheduleSearch(s.streetLine, selected);
      return;
    }
    const next = {
      ...emptyAddress(),
      ...value,
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
    onChange(next);
    setQuery(next.formatted);
    setSuggestions([]);
    setOpen(false);
    try {
      const r = await fetch("/api/address/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, address: next }),
      });
      const d = await r.json();
      if (r.ok && d.address) {
        onChange({ ...next, ...d.address, accessInstructions: value.accessInstructions });
        setQuery(d.address.formatted || next.formatted);
        if (d.message) setMessage(d.message);
      }
    } catch {
      /* keep selected suggestion */
    }
  }

  return (
    <div className="address-autocomplete">
      <label>
        {label}
        {required ? "" : <span className="optional"> optional</span>}
        <input
          value={query}
          disabled={disabled}
          required={required}
          autoComplete="street-address"
          placeholder="Start typing an address"
          maxLength={200}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            onChange({
              ...value,
              street: next,
              formatted: next,
              validated: false,
              source: "manual",
            });
            scheduleSearch(next);
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
            onChange={(e) =>
              onChange({
                ...value,
                street2: e.target.value,
                formatted: formatAddress({ ...value, street2: e.target.value }),
                validated: false,
              })
            }
          />
        </label>
        <label>
          Access instructions
          <input
            value={value.accessInstructions || ""}
            disabled={disabled}
            maxLength={1000}
            placeholder="Gate code, parking, entrance"
            onChange={(e) => onChange({ ...value, accessInstructions: e.target.value })}
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
            onChange={(e) =>
              onChange({
                ...value,
                city: e.target.value,
                formatted: formatAddress({ ...value, city: e.target.value }),
                validated: false,
                source: "manual",
              })
            }
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
            onChange={(e) =>
              onChange({
                ...value,
                state: e.target.value,
                formatted: formatAddress({ ...value, state: e.target.value }),
                validated: false,
                source: "manual",
              })
            }
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
            onChange={(e) =>
              onChange({
                ...value,
                postalCode: e.target.value,
                formatted: formatAddress({ ...value, postalCode: e.target.value }),
                validated: false,
                source: "manual",
              })
            }
          />
        </label>
      </div>
      {(message || busy) && (
        <small className="booking-field-help">
          {busy ? "Looking up addresses…" : message}
        </small>
      )}
    </div>
  );
}
