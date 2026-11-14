import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import test from "node:test";
import ts from "typescript";

function load(file) {
  const name = path.resolve(file);
  const m = new Module(name);
  m.filename = name;
  m.paths = Module._nodeModulePaths(path.dirname(name));
  m._compile(
    ts.transpileModule(fs.readFileSync(name, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText,
    name,
  );
  return m.exports;
}

const theme = load("src/lib/theme.ts");

test("theme modes resolve light, dark, and system preference", () => {
  assert.equal(theme.resolveTheme("light", true), "light");
  assert.equal(theme.resolveTheme("dark", false), "dark");
  assert.equal(theme.resolveTheme("auto", true), "dark");
  assert.equal(theme.resolveTheme("auto", false), "light");
});

test("unknown stored values fall back to auto", () => {
  assert.equal(theme.parseThemeMode("sepia"), "auto");
  assert.equal(theme.parseThemeMode(null), "auto");
  assert.equal(theme.parseThemeMode("dark"), "dark");
});

test("boot script and reader both fall back from storage to cookie", () => {
  assert.match(theme.themeBootScript, /localStorage\.getItem/);
  assert.match(theme.themeBootScript, /document\.cookie\.match/);
  assert.match(theme.themeBootScript, /catch\(e\)\{\}/);
  const source = fs.readFileSync("src/lib/theme.ts", "utf8");
  assert.match(source, /readCookieThemeMode/);
  assert.match(source, /return readCookieThemeMode\(\) \?\? "auto"/);
});

test("shell topbar backgrounds use surface tokens for dark mode contrast", () => {
  assert.match(
    fs.readFileSync("src/app/shell.css", "utf8"),
    /color-mix\(in srgb, var\(--surface-card\) 92%, transparent\)/,
  );
  assert.match(
    fs.readFileSync("src/app/workspace-design.css", "utf8"),
    /\.shell \.shell-topbar \{height:72px;background:var\(--surface-card\)/,
  );
});

test("signed-in shell mounts the theme control only for authenticated users", () => {
  const source = fs.readFileSync("src/components/app-shell.tsx", "utf8");
  assert.match(source, /themed && <ThemeControl/);
  assert.match(source, /const themed = !demo && !!user/);
  assert.match(source, /themed \? <ThemeProvider>\{shell\}<\/ThemeProvider> : shell/);
});

test("authenticated layouts include the theme boot script", () => {
  assert.match(fs.readFileSync("src/app/app/layout.tsx", "utf8"), /ThemeBootScript/);
  assert.match(fs.readFileSync("src/app/marketplace/layout.tsx", "utf8"), /ThemeBootScript/);
  assert.match(fs.readFileSync("src/app/demo/layout.tsx", "utf8"), /AppShell user=\{null\} demo/);
  assert.doesNotMatch(fs.readFileSync("src/app/demo/layout.tsx", "utf8"), /ThemeBootScript|ThemeControl/);
});

test("dark theme tokens live on html\[data-theme=dark\]", () => {
  const css = fs.readFileSync("src/app/theme.css", "utf8");
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /--surface-hover:/);
});
