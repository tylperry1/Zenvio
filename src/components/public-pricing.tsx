"use client";
import { planLimits } from "@/lib/entitlement-policy";
import { useEffect, useState } from "react";
type Plan = {
  id: string;
  name: string;
  monthly: number;
  annual: number;
  seats: number;
};
export function PublicPricing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/pricing", { signal: controller.signal })
      .then(async (r) => {
        if (r.ok) setPlans((await r.json()).plans);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!plans.length) return null;
  return (
    <div className="platform-plan-grid">
      {plans.map((p) => (
        <article key={p.id}>
          <small>
            {p.id === "free" ? "AVAILABLE NOW" : "PLANNED PAID PLAN"}
          </small>
          <h3>{p.name}</h3>
          <p>
            <b>${(p.monthly / 100).toFixed(2)}</b> / month
          </p>
          <p>
            ${(p.annual / 100).toFixed(2)} billed annually
            {p.seats > 1 ? ` per host · ${p.seats}-host minimum` : ""}
          </p>
          <p>
            {planLimits[p.id as keyof typeof planLimits]?.types} active
            appointment types ·{" "}
            {planLimits[p.id as keyof typeof planLimits]?.calendars} Google
            accounts{p.id === "teams" ? " per host" : ""} ·{" "}
            {planLimits[p.id as keyof typeof planLimits]?.envelopes}{" "}
            envelopes/month{p.id === "teams" ? " per paid host" : ""} ·{" "}
            {planLimits[p.id as keyof typeof planLimits]?.workflows} workflows
          </p>
          <span>
            {p.id === "free"
              ? "Start without a credit card."
              : "Checkout is not open yet."}
          </span>
        </article>
      ))}
    </div>
  );
}
