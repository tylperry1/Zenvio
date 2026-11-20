import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";

function load(file, deps = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => (Object.hasOwn(deps, id) ? deps[id] : original(id));
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
    filename,
  );
  return m.exports;
}

const onboarding = load("src/components/onboarding.tsx", {
  "next/link": { default: "a" },
  "./icons": { Icon: () => null },
  "./modal": { Modal: ({ children }) => children },
  "./ds": {
    Badge: ({ children }) => children,
    MeterBar: () => null,
    Panel: ({ children }) => children,
  },
  "@/lib/contractor": { industries: [{ id: "general", label: "General" }] },
});

const { hasGeneratedLink, suggestSlug, bookingLinkLabel } = onboarding;

test("suggestSlug builds a short lowercase booking address from a name", () => {
  assert.equal(suggestSlug("Tyler Perry"), "tyler-perry");
  assert.equal(suggestSlug("  Jamie   Studio!! "), "jamie-studio");
  assert.equal(suggestSlug("ab"), "");
});

test("hasGeneratedLink only matches host-uuid placeholders", () => {
  assert.equal(hasGeneratedLink("host-" + "a".repeat(32)), true);
  assert.equal(hasGeneratedLink("tyler-perry"), false);
  assert.equal(hasGeneratedLink("host-abc"), false);
});

test("bookingLinkLabel hides host-uuid noise until a short address exists", () => {
  assert.equal(bookingLinkLabel("host-" + "b".repeat(32), "discovery-call"), "Choose a short booking address");
  assert.equal(bookingLinkLabel("tyler-perry", "discovery-call"), "gozenvio.com/book/tyler-perry/discovery-call");
  assert.equal(bookingLinkLabel("jamie-studio"), "gozenvio.com/book/jamie-studio");
});

test("new accounts prefer readable slugs from the user name", () => {
  const sql = fs.readFileSync("postgres/migrations/080_readable_booking_slugs.sql", "utf8");
  assert.match(sql, /handle_new_user/);
  assert.match(sql, /regexp_replace/);
  assert.match(sql, /host-' \|\| replace\(new\.id::text/);
  assert.match(sql, /rtrim\(left\(base_slug/);
  assert.match(sql, /unique_violation/);
  assert.match(sql, /FOR attempt IN 0\.\.100/);
});

test("workspace surfaces open the short-link chooser for generated hosts", () => {
  const workspace = fs.readFileSync("src/components/workspace.tsx", "utf8");
  assert.match(workspace, /bookingLinkLabel/);
  assert.match(workspace, /Choose a short booking address/);
  assert.match(workspace, /linkPrompt\.show/);
  assert.match(workspace, /Choose link/);
});
