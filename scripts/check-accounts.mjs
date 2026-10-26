// Run after configuring the dedicated Supabase project. Never prints keys.
const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_ANON_KEY. Configure these in the process environment.",
  );
  process.exit(1);
}
if (!url.startsWith("https://"))
  throw new Error("Use the HTTPS Supabase project URL.");
const headers = {
  apikey: key,
  "Content-Type": "application/json",
  ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
};
async function request(path, body) {
  const r = await fetch(url + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, ok: r.ok, data: await r.json().catch(() => null) };
}
let failed = 0;
function check(ok, label) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
}
const publicEvent = await request("/rest/v1/rpc/public_event", {
  host_slug: "zenvio-configuration-check",
  event_slug: "zenvio-configuration-check",
});
check(
  publicEvent.ok && Array.isArray(publicEvent.data),
  "Public booking schema is available",
);
const version = await request("/rest/v1/rpc/account_schema_version", {});
check(
  version.ok && version.data === 3,
  "Account and admin migrations are installed",
);
for (const table of ["profiles", "bookings", "contacts"]) {
  const result = await request(`/rest/v1/${table}?select=id&limit=1`);
  check(
    [401, 403].includes(result.status),
    `Anonymous callers cannot read ${table}`,
  );
}
for (const [name, args] of [
  ["current_platform_role", {}],
  ["admin_overview", { page_number: 0, search_query: "", page_size: 1 }],
  ["admin_audit", { page_number: 0, page_size: 1 }],
]) {
  const result = await request(`/rest/v1/rpc/${name}`, args);
  check(
    [401, 403].includes(result.status),
    `Anonymous callers cannot execute ${name} (migration must exist)`,
  );
}
console.log(
  "Remaining manual checks: verified member and master-admin sign-in, cross-account access denial, booking and cancellation, and email delivery.",
);
process.exitCode = failed ? 1 : 0;
