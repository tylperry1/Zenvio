/** Platform/admin unlimited seats use this SQL sentinel (int4 max). Never show raw. */
export const UNLIMITED_SEATS_SENTINEL = 2_147_483_647;

/** Values at or above this are treated as unlimited for display and progress math. */
export const UNLIMITED_DISPLAY_THRESHOLD = 1_000_000_000;

export function isUnlimitedQuantity(value: unknown) {
  const n = Number(value);
  return !Number.isFinite(n) || n >= UNLIMITED_DISPLAY_THRESHOLD || n === UNLIMITED_SEATS_SENTINEL;
}

/** Human-readable allowance; never renders sentinel integers. */
export function formatAllowance(value: unknown, options?: { meter?: string }) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "Unavailable";
  if (isUnlimitedQuantity(n)) return "Unlimited";
  if (options?.meter === "storageBytes") {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
    return `${n.toLocaleString()} B`;
  }
  return n.toLocaleString();
}

/** Progress max that never uses sentinel quantities (would break meters). */
export function progressMax(included: number) {
  if (isUnlimitedQuantity(included) || included <= 0) return 1;
  return included;
}

export function progressValue(used: number, included: number) {
  if (isUnlimitedQuantity(included)) return 0;
  return Math.min(Math.max(0, used), Math.max(included, 1));
}
