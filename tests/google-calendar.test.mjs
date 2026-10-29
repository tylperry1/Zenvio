import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
const filename = path.resolve("src/lib/google-calendar.ts"),
  mod = new Module(filename);
mod.filename = filename;
mod.paths = Module._nodeModulePaths(path.dirname(filename));
const diagnosticFile = path.resolve("src/lib/google-calendar-errors.ts"),
  diagnostic = new Module(diagnosticFile);
diagnostic._compile(
  ts.transpileModule(fs.readFileSync(diagnosticFile, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  diagnosticFile,
);
const standard = mod.require.bind(mod);
mod.require = (id) =>
  id === "./entitlements"
    ? {}
    : id === "./google-calendar-errors"
      ? diagnostic.exports
      : id === "./db" || id === "./platform-settings" || id === "./server"
        ? {}
        : standard(id);
mod._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText,
  filename,
);
const { overlapsBusy, googleRedirect } = mod.exports;
test("Google conflict checks block partial and complete overlaps but allow adjacent appointments", () => {
  const busy = [{ start: "2026-11-02T15:00:00Z", end: "2026-11-02T16:00:00Z" }];
  assert.equal(
    overlapsBusy("2026-11-02T14:30:00Z", "2026-11-02T15:30:00Z", busy),
    true,
  );
  assert.equal(
    overlapsBusy("2026-11-02T15:15:00Z", "2026-11-02T15:30:00Z", busy),
    true,
  );
  assert.equal(
    overlapsBusy("2026-11-02T14:00:00Z", "2026-11-02T15:00:00Z", busy),
    false,
  );
  assert.equal(
    overlapsBusy("2026-11-02T16:00:00Z", "2026-11-02T16:30:00Z", busy),
    false,
  );
});
test("Google busy periods honor timezone offsets and all-day windows", () => {
  assert.equal(
    overlapsBusy("2026-11-02T15:00:00Z", "2026-11-02T15:30:00Z", [
      { start: "2026-11-02T10:00:00-05:00", end: "2026-11-02T11:00:00-05:00" },
    ]),
    true,
  );
  assert.equal(
    overlapsBusy("2026-11-02T15:00:00Z", "2026-11-02T15:30:00Z", [
      { start: "2026-11-02T00:00:00Z", end: "2026-11-03T00:00:00Z" },
    ]),
    true,
  );
});
test("Google callback is fixed to the configured application origin", () => {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://gozenvio.com/";
  assert.equal(
    googleRedirect("https://untrusted.test"),
    "https://gozenvio.com/api/calendars/google/callback",
  );
  if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = previous;
});
