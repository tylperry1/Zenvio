/**
 * Stripe environment isolation.
 *
 * Live and test credentials are separate secrets, but nothing in the runtime
 * stopped a misconfigured deployment from taking live cards in a preview or
 * test-mode payments in production. Billing now fails closed unless the
 * configured secret matches the environment the build is running in.
 *
 * These helpers never log, return, or serialize the key itself.
 */

export type StripeKeyMode = "test" | "live" | "unknown";
export type StripeDeploymentEnvironment = "production" | "preview" | "development";

/** Which Stripe mode a secret key belongs to. */
export function stripeKeyMode(key: unknown): StripeKeyMode {
  const value = String(key || "");
  if (value.startsWith("sk_live_") || value.startsWith("rk_live_")) return "live";
  if (value.startsWith("sk_test_") || value.startsWith("rk_test_")) return "test";
  return "unknown";
}

/**
 * Deployment environment used for the Stripe boundary.
 *
 * Vercel sets VERCEL_ENV, which is authoritative there. Self-hosted runtimes can
 * pin STRIPE_BILLING_ENV. A production Node server outside Vercel cannot be told
 * apart from a preview, so it is treated as production: only a live key is
 * accepted there, and a test-mode deployment must say so explicitly.
 */
export function stripeDeploymentEnvironment(
  env: Record<string, string | undefined> = process.env,
): StripeDeploymentEnvironment {
  const pinned = String(env.STRIPE_BILLING_ENV || "").trim().toLowerCase();
  if (pinned === "production" || pinned === "preview" || pinned === "development")
    return pinned;
  const vercel = String(env.VERCEL_ENV || "").trim().toLowerCase();
  if (vercel === "production" || vercel === "preview" || vercel === "development")
    return vercel;
  return env.NODE_ENV === "production" ? "production" : "development";
}

/** Why this key cannot be used in this environment, or null when it can. */
export function stripeKeyProblem(
  mode: StripeKeyMode,
  environment: StripeDeploymentEnvironment,
): string | null {
  if (mode === "unknown")
    return "The Stripe secret key is not a recognizable live or test key.";
  if (environment === "production")
    return mode === "live" ? null : "Production billing requires a live Stripe secret key.";
  return mode === "test"
    ? null
    : "Non-production billing requires a Stripe test-mode secret key.";
}

/** Reject a webhook delivery whose mode does not match the configured key. */
export function stripeEventModeProblem(
  livemode: boolean | undefined,
  mode: StripeKeyMode,
): string | null {
  if (mode === "unknown") return "The Stripe webhook key mode is unknown.";
  if (typeof livemode !== "boolean")
    return "The Stripe event does not declare whether it is live or test.";
  return livemode === (mode === "live")
    ? null
    : "The Stripe event environment does not match this deployment.";
}
