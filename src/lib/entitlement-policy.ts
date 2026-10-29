export const planLimits = {
  free: { types: 1, calendars: 1, envelopes: 5, workflows: 0 },
  pro: { types: 10, calendars: 5, envelopes: 25, workflows: 5 },
  business: { types: 50, calendars: 5, envelopes: 100, workflows: 20 },
  teams: { types: 100, calendars: 5, envelopes: 100, workflows: 25 },
} as const;
export type Plan = keyof typeof planLimits;
