import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import test from "node:test";
import ts from "typescript";

function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => mocks[id] ?? original(id);
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    filename,
  );
  return m.exports;
}

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const DI = load("src/lib/digital-identity.ts", { "./server": { ApiError } });
const NFC = load("src/lib/nfc-studio.ts", {
  "./server": { ApiError },
  "./db": { getPool: () => ({ query: async () => ({ rows: [] }) }) },
  "./digital-identity": DI,
  "./nfc/ndef": {
    normalizeHttpsUrl: (u) => {
      const url = new URL(u);
      if (url.protocol !== "https:") throw new Error("https required");
      return url.href;
    },
  },
});

test("profile kinds and visibility are validated", () => {
  assert.equal(DI.cleanProfileKind("business"), "business");
  assert.throws(() => DI.cleanProfileKind("contractor"), ApiError);
  assert.equal(DI.cleanVisibility("unlisted"), "unlisted");
  assert.throws(() => DI.cleanVisibility("secret"), ApiError);
  assert.equal(DI.publishedFromVisibility("private", true), false);
  assert.equal(DI.publishedFromVisibility("public", true), true);
  assert.equal(DI.publishedFromVisibility("unlisted"), true);
});

test("canonical profile and card URLs stay stable for QR and NFC", () => {
  assert.equal(DI.canonicalProfilePath("jane-doe"), "/p/jane-doe");
  assert.equal(DI.canonicalProfileUrl("https://gozenvio.com", "jane-doe", "qr"), "https://gozenvio.com/p/jane-doe?via=qr");
  assert.equal(
    DI.canonicalCardUrl("https://gozenvio.com", "abcdefghijklmnopqrstuvwx", "nfc"),
    "https://gozenvio.com/c/abcdefghijklmnopqrstuvwx?src=nfc",
  );
  assert.equal(NFC.smartCardProgramUrl("https://gozenvio.com", "abcdefghijklmnopqrstuvwx").includes("src=nfc"), true);
});

test("view channel resolution distinguishes nfc from card and qr", () => {
  assert.equal(DI.resolveViewChannel("qr", null), "qr");
  assert.equal(DI.resolveViewChannel(null, "nfc"), "nfc");
  assert.equal(DI.resolveViewChannel("card", null), "card");
  assert.equal(DI.resolveViewChannel(null, null), "link");
});

test("capacity messaging does not invent plan prices", () => {
  assert.equal(DI.DIGITAL_IDENTITY_LIMITS.profiles, 5);
  assert.equal(DI.DIGITAL_IDENTITY_LIMITS.cards, 50);
  assert.match(DI.upgradeMessageFor("profiles"), /Plan & billing/);
  assert.doesNotMatch(DI.upgradeMessageFor("cards"), /\$\d/);
});

test("Identity Management Center routes and nav exist", () => {
  for (const file of [
    "src/app/app/identity/page.tsx",
    "src/app/app/identity/cards/page.tsx",
    "src/app/app/identity/nfc/page.tsx",
    "src/app/app/identity/qr/page.tsx",
    "src/app/app/identity/contacts/page.tsx",
    "src/app/app/identity/analytics/page.tsx",
    "src/app/app/identity/design/page.tsx",
    "src/components/digital-identity-navigation.tsx",
    "src/components/identity-qr-center.tsx",
    "src/components/identity-contact-exchange.tsx",
    "src/components/identity-analytics.tsx",
    "src/components/identity-design-center.tsx",
    "postgres/migrations/104_digital_identity.sql",
  ]) {
    assert.ok(fs.existsSync(file), file);
  }
  const nav = fs.readFileSync("src/components/digital-identity-navigation.tsx", "utf8");
  for (const label of ["My Profiles", "Smart Cards", "NFC Studio", "QR Codes", "Contact Exchange", "Analytics", "Design & Branding"]) {
    assert.match(nav, new RegExp(label));
  }
  const shell = fs.readFileSync("src/components/app-shell.tsx", "utf8");
  assert.match(shell, /digital-identity/);
  assert.match(shell, /\/app\/identity/);
  const middleware = fs.readFileSync("src/middleware.ts", "utf8");
  assert.match(middleware, /\/app\/identity/);
});

test("card redirect attributes NFC separately and keeps absolute Location", () => {
  const redirect = fs.readFileSync("src/app/c/[token]/route.ts", "utf8");
  assert.match(redirect, /resolveViewChannel/);
  assert.match(redirect, /src=nfc|viewChannel === "nfc"/);
  assert.match(redirect, /"Referrer-Policy": "no-referrer"/);
  assert.match(redirect, /card_id/);
});

test("migration extends channels and actions without inventing pricing", () => {
  const sql = fs.readFileSync("postgres/migrations/104_digital_identity.sql", "utf8");
  assert.match(sql, /profile_kind/);
  assert.match(sql, /smart_profile_slug_redirects/);
  assert.match(sql, /'nfc'/);
  assert.match(sql, /smart_profile_attribution/);
  assert.doesNotMatch(sql, /stripe|price_id|\$\d+/i);
});

test("public profile does not embed via into raw script HTML", () => {
  const page = fs.readFileSync("src/app/p/[slug]/page.tsx", "utf8");
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
  assert.match(page, /PublicProfileClickTracker/);
  assert.match(page, /allowlistedVia|VIEW_CHANNELS/);
  assert.match(page, /sc-public-designed-actions/);
});

test("slug create reserves redirects and publish without visibility stays public", () => {
  const api = fs.readFileSync("src/app/api/smart-profiles/route.ts", "utf8");
  assert.match(api, /smart_profile_slug_redirects WHERE old_slug/);
  assert.match(api, /else f\.visibility = published \? "public" : "private"/);
  assert.ok(fs.existsSync("postgres/migrations/105_digital_identity_slug_guard.sql"));
  assert.match(fs.readFileSync("postgres/migrations/105_digital_identity_slug_guard.sql", "utf8"), /guard_smart_profile_slug/);
});

test("vCard and booking routes preserve visit channel", () => {
  const vcard = fs.readFileSync("src/app/p/[slug]/vcard/route.ts", "utf8");
  const booking = fs.readFileSync("src/app/p/[slug]/booking/route.ts", "utf8");
  assert.match(vcard, /resolveViewChannel/);
  assert.match(booking, /resolveViewChannel/);
  assert.match(vcard, /channel/);
  assert.match(booking, /channel/);
  // Booking destination src must distinguish nfc/qr while keeping smart-card for card/default.
  assert.match(booking, /bookingSourceParam|searchParams\.set\("src"/);
  assert.match(booking, /"nfc"/);
  assert.match(booking, /"qr"/);
  assert.match(booking, /"smart-card"/);
});

test("click trackers fall back when sendBeacon returns false", () => {
  const tracker = fs.readFileSync("src/components/public-profile-click-tracker.tsx", "utf8");
  const actions = fs.readFileSync("src/components/public-profile-actions.tsx", "utf8");
  for (const src of [tracker, actions]) {
    assert.match(src, /sendBeacon/);
    assert.match(src, /queued/);
    assert.match(src, /if\s*\(\s*!queued\s*\)/);
    assert.doesNotMatch(src, /keepalive:\s*true/);
  }
});

test("analytics labels verified bookings as account-wide", () => {
  const ui = fs.readFileSync("src/components/identity-analytics.tsx", "utf8");
  assert.match(ui, /Account-wide/);
});
