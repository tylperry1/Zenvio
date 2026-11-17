/** Shared calendar helpers for Financial Intelligence date filters. */

export type FinancialPeriodId =
  | "this_month"
  | "last_month"
  | "last_30d"
  | "last_90d"
  | "ytd"
  | "custom";

export type FinancialPeriod = {
  id: FinancialPeriodId;
  label: string;
  start: Date;
  end: Date;
};

function startOfUtcMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfUtcMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

function parseDate(value: string | null | undefined, label: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${label} date.`);
  }
  const [y, m, day] = value.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, day));
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() !== m - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ${label} date.`);
  }
  return d;
}

export function resolveFinancialPeriod(
  id: string | null | undefined,
  customStart?: string | null,
  customEnd?: string | null,
  now = new Date(),
): FinancialPeriod {
  const endNow = new Date(now.getTime());
  switch (id) {
    case "last_month": {
      const start = startOfUtcMonth(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
      );
      return {
        id: "last_month",
        label: "Last month (UTC)",
        start,
        end: endOfUtcMonth(start),
      };
    }
    case "last_30d":
      return {
        id: "last_30d",
        label: "Last 30 days",
        start: new Date(endNow.getTime() - 30 * 86400000),
        end: endNow,
      };
    case "last_90d":
      return {
        id: "last_90d",
        label: "Last 90 days",
        start: new Date(endNow.getTime() - 90 * 86400000),
        end: endNow,
      };
    case "ytd":
      return {
        id: "ytd",
        label: "Year to date (UTC)",
        start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
        end: endNow,
      };
    case "custom": {
      const start = parseDate(customStart, "range start");
      const endExclusive = parseDate(customEnd, "range end");
      // Treat end date as inclusive calendar day → exclusive next day.
      const end = new Date(endExclusive.getTime() + 86400000);
      if (end <= start) throw new Error("Custom range end must be after start.");
      if (end.getTime() - start.getTime() > 366 * 86400000) {
        throw new Error("Custom range cannot exceed 366 days.");
      }
      return {
        id: "custom",
        label: `Custom ${customStart} → ${customEnd}`,
        start,
        end,
      };
    }
    case "this_month":
    case null:
    case undefined:
    case "":
      return {
        id: "this_month",
        label: "This month (UTC)",
        start: startOfUtcMonth(now),
        end: endNow,
      };
    default:
      throw new Error("Unsupported financial period.");
  }
}
