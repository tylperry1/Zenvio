/** Shared loading UI for route `loading.tsx` and Suspense fallbacks — never paint an empty screen. */
export function RouteLoading({
  label = "Loading…",
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={compact ? "route-loading route-loading-compact" : "route-loading"}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="route-loading-spinner" aria-hidden="true" />
      <p>{label}</p>
      {!compact && (
        <div className="route-loading-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </div>
  );
}
