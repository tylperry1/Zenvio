// Only runs inside this repository's main-branch GitHub workflow. Never prints tokens or message bodies.
const audience = "https://gozenvio.com/api/jobs";
async function run() {
  if (
    process.env.GITHUB_REPOSITORY !== "tylperry1/Zenvio" ||
    process.env.GITHUB_REF !== "refs/heads/main"
  )
    throw Error("Trusted repository main branch required");
  const requestUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL || "");
  if (
    requestUrl.protocol !== "https:" ||
    !requestUrl.hostname.endsWith(".actions.githubusercontent.com")
  )
    throw Error("Invalid identity endpoint");
  requestUrl.searchParams.set("audience", audience);
  const identity = await fetch(requestUrl, {
    headers: {
      Authorization: "Bearer " + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!identity.ok) throw Error("Identity request failed");
  const token = (await identity.json()).value;
  if (typeof token !== "string") throw Error("Identity unavailable");
  const probe = process.env.SCHEDULED_JOB_MODE === "verify";
  const response = await fetch(audience + (probe ? "?probe=1" : ""), {
    headers: { Authorization: "Bearer " + token },
    redirect: "error",
    signal: AbortSignal.timeout(310000),
  });
  if (!response.ok)
    throw Error("Scheduled endpoint returned HTTP " + response.status);
  const result = await response.json();
  if (!result.configured)
    throw Error("Resend sender or integration configuration is missing");
  if (probe && result.emailDiagnostics)
    console.log(
      "Email diagnostics: " + JSON.stringify(result.emailDiagnostics),
    );
  console.log(
    probe
      ? "Scheduler identity and existing Resend configuration verified; no deliveries processed."
      : result.busy
        ? "Another worker is processing the queue."
        : "Scheduled processing completed. Deliveries accepted: " +
          Number(result.sent || 0),
  );
}
run().catch(() => {
  console.error(
    "Scheduled processing failed. Check production scheduler health and delivery settings. No credentials or recipient data were logged.",
  );
  process.exitCode = 1;
});
