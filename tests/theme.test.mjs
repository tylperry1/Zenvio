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

test("shell mounts theme control for signed-in and demo chrome", () => {
  const source = fs.readFileSync("src/components/app-shell.tsx", "utf8");
  assert.match(source, /themed && <ThemeControl/);
  assert.match(source, /const themed = demo \|\| !!user/);
  assert.match(source, /themed \? <ThemeProvider>\{shell\}<\/ThemeProvider> : shell/);
});

test("root layout boots theme for every visitor; provider for signed-in", () => {
  const root = fs.readFileSync("src/app/layout.tsx", "utf8");
  assert.match(root, /themeSessionActive/);
  assert.match(root, /ThemeBootScript/);
  assert.match(root, /PublicThemeSync/);
  assert.match(root, /ThemeProvider/);
  assert.match(root, /signedIn \? \(/);
  assert.match(fs.readFileSync("src/app/demo/layout.tsx", "utf8"), /ThemeBootScript/);
  const admin = fs.readFileSync("src/app/admin/layout.tsx", "utf8");
  assert.match(admin, /ThemeBootScript/);
  assert.match(admin, /ThemeProvider/);
  assert.match(
    fs.readFileSync("src/components/admin-navigation.tsx", "utf8"),
    /<ThemeControl \/>/,
  );
  assert.match(
    fs.readFileSync("src/components/theme-control.tsx", "utf8"),
    /if \(parent\) return/,
  );
});

test("rebrand public canvases use semantic tokens instead of light-only hex", () => {
  const rebrand = fs.readFileSync("src/app/rebrand.css", "utf8");
  assert.doesNotMatch(rebrand, /body \.marketing-v3 \{[^}]*#f8faff/);
  assert.doesNotMatch(rebrand, /body :is\(\.vc-page,\.market-public\)\{[^}]*#f8faff/);
  assert.doesNotMatch(rebrand, /body \.vc-card\{[^}]*background:white/);
  assert.doesNotMatch(rebrand, /body \.auth-box\{[^}]*background:#fff/);
  assert.doesNotMatch(rebrand, /body \.hc-articles article\{[^}]*background:#fff/);
  assert.match(rebrand, /body :is\(\.vc-page,\.market-public\)\{[^}]*var\(--surface-page\)/);
  assert.match(rebrand, /body \.vc-card\{[^}]*var\(--surface-card\)/);
  assert.match(rebrand, /body \.auth-box\{[^}]*var\(--surface-card\)/);
  const pricing = fs.readFileSync("src/app/subscriptions.css", "utf8");
  assert.match(pricing, /\.subscription-pricing-page\{[^}]*var\(--surface-page\)/);
  assert.doesNotMatch(pricing, /\.subscription-pricing-page\{[^}]*background:#f6f7fb/);
  assert.match(pricing, /\.subscription-faq details p\{[^}]*var\(--text-secondary\)/);
  assert.match(pricing, /\.subscription-footnote\{[^}]*var\(--text-secondary\)/);
  const globals = fs.readFileSync("src/app/globals.css", "utf8");
  assert.match(
    globals,
    /html\[data-theme="dark"\] :is\(\.mkc-qr-img, \.sc-qr\) \.logo:not\(\.logo-light\) img\[src\$="zenvio-symbol\.svg"\]/,
  );
  assert.match(
    fs.readFileSync("src/app/marketing.css", "utf8"),
    /html\[data-theme="dark"\] \.mk-qr \.logo:not\(\.logo-light\) img\[src\$="zenvio-symbol\.svg"\]/,
  );
  const verify = fs.readFileSync("scripts/theme-coherence-verify.mjs", "utf8");
  assert.match(verify, /el\.matches\?\.\("input,select,textarea"\)/);
  assert.match(verify, /assert\.ok\(field\.inputBg/);
});

test("dark theme tokens live on html[data-theme=dark] without workspace shadowing", () => {
  const css = fs.readFileSync("src/app/theme.css", "utf8");
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /--surface-page:\s*#0b1020/i);
  assert.match(css, /--surface-card:\s*#141d33/i);
  assert.match(css, /--text-primary:\s*#f3f6fd/i);
  const workspace = fs.readFileSync("src/app/workspace-design.css", "utf8");
  assert.doesNotMatch(workspace, /\.workspace,.suite-workspace \{[^}]*--surface-page:/);
  const rebrand = fs.readFileSync("src/app/rebrand.css", "utf8");
  assert.doesNotMatch(rebrand, /:root \{[^}]*--surface-page:/);
  assert.match(rebrand, /body \.shell-topbar \{[^}]*var\(--surface-card\)/);
});

test("shell tall-page gradient uses theme tokens instead of a fixed light canvas", () => {
  const ui = fs.readFileSync("src/app/ui.css", "utf8");
  assert.match(
    ui,
    /linear-gradient\(\s*to right,\s*var\(--surface-navigation\) var\(--shell-sidebar\),\s*var\(--surface-page\) var\(--shell-sidebar\)\s*\)/,
  );
  assert.doesNotMatch(ui, /#f4f5f8/);
});

test("dark promo headings and calendar entries keep readable theme colors", () => {
  const rebrand = fs.readFileSync("src/app/rebrand.css", "utf8");
  assert.match(rebrand, /\.portal-hero[\s\S]{0,200}:is\(h1,h2,h3,h4\) \{ color: #fff; \}/);
  assert.match(rebrand, /\.zg-card-promo/);
  const suite = fs.readFileSync("src/app/suite.css", "utf8");
  assert.match(suite, /calendar-entry\{[^}]*color:var\(--text-primary\)!important/);
  assert.doesNotMatch(suite, /calendar-entry\{[^}]*color:#21375f!important/);
  const admin = fs.readFileSync("src/app/admin/admin.css", "utf8");
  assert.match(admin, /acx-topbar\{[^}]*color-mix\(in srgb, var\(--surface-card\) 86%/);
  assert.doesNotMatch(admin, /ap-package\.featured\{[^}]*#fff 40%/);
});
