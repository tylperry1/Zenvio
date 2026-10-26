import { backend, configured } from "./server";
/** Probe only a public RPC; no user records or secrets are returned. */
export async function accountReadiness() {
  if (!configured()) return false;
  try {
    const version = await backend("/rest/v1/rpc/account_schema_version", {
      method: "POST",
      body: "{}",
    });
    if (version !== 4) return false;
    await backend("/rest/v1/rpc/public_event", {
      method: "POST",
      body: JSON.stringify({
        host_slug: "zenvio-configuration-check",
        event_slug: "zenvio-configuration-check",
      }),
    });
    return true;
  } catch {
    return false;
  }
}
