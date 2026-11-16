import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";

function load(file) {
  const name = path.resolve(file);
  const m = new Module(name);
  m.filename = name;
  m.paths = Module._nodeModulePaths(path.dirname(name));
  m._compile(
    ts.transpileModule(fs.readFileSync(name, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    name,
  );
  return m.exports;
}

test("platformOrigin rejects non-https defaults and prefers gozenvio.com", () => {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  try {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const email = load("src/lib/transactional-email.ts");
    assert.equal(email.platformOrigin(), "https://gozenvio.com");
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    assert.equal(email.platformOrigin(), "https://gozenvio.com");
    process.env.NEXT_PUBLIC_APP_URL = "https://preview.example.com";
    assert.equal(email.platformOrigin(), "https://preview.example.com");
  } finally {
    if (previous == null) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
  }
});
