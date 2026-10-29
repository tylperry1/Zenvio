// Configuration and identity verification are distinct from actual delivery.
export function scheduledProbeStatus(result) {
  const d = result?.emailDiagnostics;
  if (!result?.configured || !d)
    return {
      ok: false,
      message:
        "Scheduler identity verified, but email provider configuration could not be verified.",
    };
  if (
    d.credentialStatus === "accepted" &&
    d.domainStatus === "verified" &&
    !d.issue
  )
    return {
      ok: true,
      message:
        "Scheduler identity, Resend credentials and sender-domain authorization verified; no deliveries processed.",
    };
  if (
    d.credentialStatus === "sending_only" &&
    d.senderDomain &&
    d.senderDomain !== "resend.dev" &&
    d.domainStatus === "not_checked" &&
    !d.issue
  )
    return {
      ok: true,
      message:
        "Scheduler identity verified and a sending-only key recognized. Sender-domain authorization must be checked in Resend; no deliveries processed.",
    };
  return {
    ok: false,
    message:
      d.credentialStatus === "rejected"
        ? "Scheduler identity verified, but Resend rejected the configured API key. Update the integration settings."
        : "Scheduler identity verified, but the Resend sender/domain configuration is not verified. Review email diagnostics.",
  };
}
