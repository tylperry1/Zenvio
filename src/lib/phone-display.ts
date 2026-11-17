/** Client-safe phone formatting (no server imports). */
export function formatPhoneDisplay(e164: string): string {
  const v = e164.trim();
  if (/^\+1[0-9]{10}$/.test(v)) {
    const n = v.slice(2);
    return `+1 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  return v;
}
