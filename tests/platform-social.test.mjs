import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
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
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
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

const string = (value, name, max, min = 0) => {
  const raw = String(value ?? "").trim();
  if (raw.length < min) throw new ApiError(`Enter ${name}.`);
  if (raw.length > max) throw new ApiError(`${name} is too long.`);
  return raw;
};

const profileDetails = load("src/lib/profile-details.ts", {
  "./server": { ApiError, string },
  "./contractor": { industries: [{ id: "general", label: "General" }] },
});

const { parsePlatformSocialLinks } = load("src/lib/platform-social.ts", {
  "./db": { getPool: () => ({ query: async () => ({ rows: [] }) }), databaseConfigured: () => false },
  "./server": { ApiError },
  "./profile-details": profileDetails,
});

test("platform social links normalize https urls and optional labels", () => {
  const links = parsePlatformSocialLinks([
    { network: "instagram", url: "instagram.com/zenvio", label: " Instagram " },
    { network: "linkedin", url: "https://linkedin.com/company/zenvio" },
  ]);
  assert.equal(links.length, 2);
  assert.equal(links[0].url, "https://instagram.com/zenvio");
  assert.equal(links[0].label, "Instagram");
  assert.equal(links[1].label, undefined);
});

test("platform social links reject website, duplicates, and oversized lists", () => {
  assert.throws(
    () => parsePlatformSocialLinks([{ network: "website", url: "https://gozenvio.com" }]),
    ApiError,
  );
  assert.throws(
    () =>
      parsePlatformSocialLinks([
        { network: "x", url: "https://x.com/a" },
        { network: "x", url: "https://x.com/b" },
      ]),
    /Only one X/,
  );
  assert.throws(
    () =>
      parsePlatformSocialLinks(
        Array.from({ length: 9 }, (_, i) => ({
          network: ["instagram", "facebook", "linkedin", "x", "tiktok", "youtube", "yelp", "google", "nextdoor"][i],
          url: `https://example.com/${i}`,
        })),
      ),
    /eight social links/,
  );
});

test("master admin social API and launch UI are wired for platform social links", () => {
  const route = fs.readFileSync("src/app/api/admin/platform-social/route.ts", "utf8");
  const launch = fs.readFileSync("src/components/launch-control-admin.tsx", "utf8");
  const migration = fs.readFileSync("postgres/migrations/083_platform_social_links.sql", "utf8");
  const home = fs.readFileSync("src/app/page.tsx", "utf8");
  const contact = fs.readFileSync("src/app/contact/page.tsx", "utf8");
  assert.match(route, /adminSession\(\)/);
  assert.match(route, /platform_social_links/);
  assert.match(route, /platform_social_links_updated/);
  assert.match(launch, /PlatformSocialAdmin/);
  assert.match(migration, /platform_social_links/);
  assert.match(home, /platformSocialLinks/);
  assert.match(home, /PlatformSocialLinks/);
  assert.match(contact, /platformSocialLinks/);
});
