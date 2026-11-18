/** Pure appointment edit change detector (no DB / Next deps). */

function iso(value) {
  return new Date(value).toISOString();
}

function addressText(value) {
  if (!value || typeof value !== "object") return "";
  const formatted = typeof value.formatted === "string" ? value.formatted.trim() : "";
  if (formatted) return formatted;
  const parts = [value.street, value.street2, value.city, value.state, value.postalCode, value.country]
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

/** Compare persisted booking state to a proposed patch and return meaningful diffs only. */
export function detectBookingChanges(before, after) {
  const changes = [];
  const push = (field, previous, next) => {
    if (previous === next) return;
    if (String(previous ?? "") === String(next ?? "")) return;
    changes.push({ field, previous, next });
  };

  if (after.starts_at != null) push("starts_at", iso(before.starts_at), iso(after.starts_at));
  if (after.ends_at != null) push("ends_at", iso(before.ends_at), iso(after.ends_at));
  if (after.starts_at != null && after.ends_at != null) {
    const prevDur = new Date(before.ends_at).getTime() - new Date(before.starts_at).getTime();
    const nextDur = new Date(after.ends_at).getTime() - new Date(after.starts_at).getTime();
    if (prevDur !== nextDur) push("duration", prevDur, nextDur);
  }
  if (after.guest_name != null) push("guest_name", before.guest_name, after.guest_name);
  if (after.guest_email != null) push("guest_email", before.guest_email, after.guest_email);
  if (after.guest_phone != null) push("guest_phone", before.guest_phone || "", after.guest_phone || "");
  if (after.guest_company != null)
    push("guest_company", before.guest_company || "", after.guest_company || "");
  if (after.meeting_purpose != null)
    push("meeting_purpose", before.meeting_purpose || "", after.meeting_purpose || "");
  if (after.notes != null) push("notes", before.notes || "", after.notes || "");
  if (after.location_mode != null)
    push("location_mode", before.location_mode || "", after.location_mode || "");
  if (after.location != null) push("location", before.location || "", after.location || "");
  if (after.service_address !== undefined) {
    const prev = addressText(before.service_address) || before.location || "";
    const next = addressText(after.service_address) || after.location || "";
    if (prev !== next) push("location", prev, next);
  }
  if (after.access_instructions != null)
    push("access_instructions", before.access_instructions || "", after.access_instructions || "");
  if (after.event_id != null) push("event_id", before.event_id || "", after.event_id);
  if (after.status != null) push("status", before.status || "", after.status);
  if (after.assigned_user_id !== undefined)
    push("assigned_employee", before.assigned_user_id || "", after.assigned_user_id || "");
  return changes;
}
