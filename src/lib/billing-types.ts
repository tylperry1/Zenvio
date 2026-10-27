export type Plan = {
  id: string;
  name: string;
  monthly: number;
  annual: number;
  seats: number;
};
export type Subscription = {
  user_id?: string;
  name?: string;
  email?: string;
  plan: string;
  status: string;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  has_customer?: boolean;
  has_subscription?: boolean;
};
export type Invoice = {
  id: string;
  number: string | null;
  status: string | null;
  amountPaid: number;
  amountDue: number;
  currency: string;
  created: number;
  url: string | null;
};
export const billingDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" })
    : "—";
export const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
export const canChangeSubscription = (s: Subscription) =>
  Boolean(
    s.has_subscription &&
    ["active", "trialing", "past_due", "unpaid"].includes(s.status),
  );
