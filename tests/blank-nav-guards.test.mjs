import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

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
    "src/app/p/loading.tsx",
    "src/app/p/error.tsx",
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

test("public digital profile pages SSR a missing-profile UI instead of blank notFound()", () => {
  const page = read("src/app/p/[slug]/page.tsx");
  assert.match(page, /MissingProfile/);
  assert.match(page, /This profile isn’t available/);
  assert.doesNotMatch(page, /from "next\/navigation"/);
  assert.doesNotMatch(page, /\bnotFound\s*\(/);
  assert.match(read("src/app/p/loading.tsx"), /Loading profile/);
});

test("missing public profile renders heading and About Zenvio link when loadPublicProfile is null", async () => {
  const filename = path.resolve("src/app/p/[slug]/page.tsx");
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = m.require.bind(m);
  const mocks = {
    "@/components/profile-experience": { ProfileExperience: () => null },
    "next/link": ({ children, ...props }) => React.createElement("a", props, children),
    "next/headers": { headers: async () => new Headers() },
    "@/components/smart-card-lead-form": { SmartCardLeadForm: () => null },
    "@/components/public-profile-actions": { PublicProfileActions: () => null },
    "@/components/public-profile-click-tracker": { PublicProfileClickTracker: () => null },
    "@/lib/digital-identity": {
      VIEW_CHANNELS: ["link", "card", "qr", "nfc"],
    },
    "@/components/icons": { Icon: () => null, Logo: () => React.createElement("span", null, "Logo") },
    "@/lib/smart-cards": {
      loadPublicProfile: async () => null,
      recordProfileView: async () => {
        throw new Error("recordProfileView must not run for missing profiles");
      },
    },
  };
  m.require = (id) => (Object.hasOwn(mocks, id) ? mocks[id] : normal(id));
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
  const html = renderToStaticMarkup(
    await m.exports.default({
      params: Promise.resolve({ slug: "missing-profile" }),
      searchParams: Promise.resolve({}),
    }),
  );
  assert.match(html, /<h1>This profile isn’t available<\/h1>/);
  assert.match(html, /href="\/"[^>]*>About Zenvio<\/a>/);
  assert.match(html, /sc-public sc-inactive/);
  assert.doesNotMatch(html, /sc-public-designed|Save contact|ProfileExperience/);
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
  assert.match(route, /NEXT_PUBLIC_APP_URL/);
  assert.match(route, /https:\/\/gozenvio\.com/);
  assert.doesNotMatch(route, /new URL\(destination, request\.url\)/);
  assert.match(route, /"Referrer-Policy": "no-referrer"/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(route, /Location:\s*target/);
});
