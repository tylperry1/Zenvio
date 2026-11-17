/** Shared Stripe test-mode gate for provision scripts. Never use live keys for v4 sync. */
export function evaluateStripeTestModeKey(key) {
  if (!key) {
    return {
      proceed: false,
      exitCode: 0,
      message: "Pricing v4 sync pending: Stripe secret key missing.",
    };
  }
  if (!String(key).startsWith("sk_test_")) {
    return {
      proceed: false,
      exitCode: 1,
      message: "Pricing v4 sync refused: Stripe secret key is not test mode (sk_test_).",
    };
  }
  return { proceed: true, exitCode: 0, message: null };
}
