import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("route loading and nested error boundaries exist", () => {
  // No root src/app/loading.tsx: App Router streams that fallback with HTTP 200
  // before page-level notFound() (e.g. marketplace visibility) can return 404.
  assert.equal(fs.existsSync("src/app/loading.tsx"), false);
  for (const path of [
    "src/app/app/loading.tsx",
    "src/app/demo/loading.tsx",
    "src/app/portal/loading.tsx",
    "src/app/admin/loading.tsx",
    "src/app/app/error.tsx",
    "src/app/admin/error.tsx",
    "src/app/global-error.tsx",
    "src/components/route-loading.tsx",
  ]) {
    assert.ok(fs.existsSync(path), `missing ${path}`);
  }
  assert.match(read("src/components/route-loading.tsx"), /RouteLoading/);
  assert.match(read("src/app/app/error.tsx"), /Back to dashboard/);
  assert.match(read("src/app/global-error.tsx"), /Try again/);
});

test("Suspense around workspace surfaces provides a visible fallback", () => {
  for (const path of [
    "src/app/app/page.tsx",
    "src/app/demo/page.tsx",
    "src/app/app/inbox/page.tsx",
    "src/app/app/clients/page.tsx",
    "src/app/app/jobs/page.tsx",
    "src/app/admin/billing/page.tsx",
  ]) {
    const src = read(path);
    assert.match(src, /<Suspense/, path);
    assert.match(src, /fallback=\{/, `${path} must pass a Suspense fallback`);
    assert.doesNotMatch(src, /<Suspense>\s*\n/, `${path} must not use bare <Suspense>`);
  }
});

test("shell leaves the app with a hard navigation to marketing home", () => {
  const shell = read("src/components/app-shell.tsx");
  assert.match(shell, /<a role="menuitem" href="\/"/);
  assert.doesNotMatch(shell, /<Link role="menuitem" href="\/"/);
});

test("smart card NFC redirects use absolute Location with privacy headers", () => {
  const route = read("src/app/c/[token]/route.ts");
  assert.match(route, /new URL\(destination, request\.url\)/);
  assert.match(route, /"Referrer-Policy": "no-referrer"/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(route, /Location:\s*target/);
});
