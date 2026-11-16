/** Platform/admin unlimited seats use this SQL sentinel (int4 max). Never show raw. */
export const UNLIMITED_SEATS_SENTINEL = 2_147_483_647;

/** Seat/count quantities at or above this are treated as unlimited for display. */
export const UNLIMITED_COUNT_THRESHOLD = 1_000_000_000;

export function isUnlimitedQuantity(value: unknown, options?: { meter?: string }) {
  // Storage allowances are multi-GB byte counts and must never use the seat sentinel rule.
  if (options?.meter === "storageBytes") return false;
  const n = Number(value);
  return !Number.isFinite(n) || n >= UNLIMITED_COUNT_THRESHOLD || n === UNLIMITED_SEATS_SENTINEL;
}

/** Human-readable allowance; never renders seat sentinels as raw integers. */
export function formatAllowance(value: unknown, options?: { meter?: string }) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "Unavailable";
  if (options?.meter === "storageBytes") {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
    return `${n.toLocaleString()} B`;
  }
  if (isUnlimitedQuantity(n, options)) return "Unlimited";
  return n.toLocaleString();
}

/** Progress max that never uses sentinel quantities (would break meters). */
export function progressMax(included: number, options?: { meter?: string }) {
  if (options?.meter === "storageBytes") return Math.max(included, 1);
  if (isUnlimitedQuantity(included, options) || included <= 0) return 1;
  return included;
}

export function progressValue(used: number, included: number, options?: { meter?: string }) {
  if (options?.meter === "storageBytes") return Math.min(Math.max(0, used), Math.max(included, 1));
  if (isUnlimitedQuantity(included, options)) return 0;
  return Math.min(Math.max(0, used), Math.max(included, 1));
}
