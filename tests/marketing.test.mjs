import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => (id === "./db" ? { getPool: () => ({}) } : original(id));
  m._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return m.exports;
}
const { cleanAttribution, normalizeToken, hashToken, newReviewToken } = load("src/lib/marketing.ts");

test("explicit source tags are normalized and malformed ones fall back to direct", () => {
  assert.equal(cleanAttribution({ source: "Instagram" }).source, "instagram");
  assert.equal(cleanAttribution({ source: "Spring Flyer" }).source, "spring-flyer");
  assert.equal(cleanAttribution({ source: "<script>" }).source, "direct");
  assert.equal(cleanAttribution({ source: "x".repeat(80) }).source.length, 40);
  assert.equal(cleanAttribution(null).source, "direct");
  assert.equal(normalizeToken(42), null);
});

test("referrers map to readable channels and never store Zenvio's own pages", () => {
  assert.equal(cleanAttribution({ referrer: "https://www.google.com/search?q=x" }).source, "google");
  assert.equal(cleanAttribution({ referrer: "https://l.instagram.com/" }).source, "instagram");
  assert.equal(cleanAttribution({ referrer: "https://blog.example.org/post" }).source, "referral");
  assert.equal(cleanAttribution({ referrer: "https://blog.example.org/post" }).referrerHost, "blog.example.org");
  const own = cleanAttribution({ referrer: "https://gozenvio.com/book/a" });
  assert.equal(own.source, "direct");
  assert.equal(own.referrerHost, null);
  assert.equal(cleanAttribution({ referrer: "not a url" }).source, "direct");
  // An explicit tag wins over the referrer.
  assert.equal(cleanAttribution({ source: "qr", referrer: "https://google.com" }).source, "qr");
});

test("campaigns are bounded and review tokens are stored only as hashes", () => {
  assert.equal(cleanAttribution({ campaign: "c".repeat(200) }).campaign.length, 80);
  const { token, hash } = newReviewToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hash, hashToken(token));
  assert.equal(hash.length, 64);
});

test("review routes enforce ownership, single use and content-policy-only hiding", () => {
  const owner = fs.readFileSync("src/app/api/reviews/route.ts", "utf8");
  const submit = fs.readFileSync("src/app/api/reviews/submit/route.ts", "utf8");
  const lib = fs.readFileSync("src/lib/marketing.ts", "utf8");
  assert.match(owner, /b\.user_id=\$2 AND b\.status='confirmed' AND b\.ends_at<now\(\)/);
  assert.match(owner, /Object\.hasOwn\(hiddenReasons, reason\)/);
  assert.match(owner, /sameOrigin\(request\)/);
  assert.match(submit, /FOR UPDATE OF q/);
  assert.match(submit, /used_at=now\(\)/);
  assert.match(submit, /allowRequest\("review"/);
  // The public average must include hidden and private ratings.
  const summary = lib.match(/FROM private\.reviews WHERE user_id=\$1`/);
  assert.ok(summary, "summary aggregates every review for the owner");
});

test("booking source recording cannot block a reservation", () => {
  const book = fs.readFileSync("src/app/api/book/route.ts", "utf8");
  assert.match(book, /after\(\(\) =>\s*recordBookingSource\([\s\S]*?\.catch\(/);
  const visit = fs.readFileSync("src/app/api/marketing/visit/route.ts", "utf8");
  assert.match(visit, /allowRequest\("booking-view"/);
  assert.match(visit, /sameOrigin\(request\)/);
});

test("the website widget only opens tagged booking links for valid hosts", () => {
  const src = fs.readFileSync("public/widget.js", "utf8");
  function run(attrs) {
    const appended = [];
    const el = () => ({ style: {}, setAttribute() {}, getAttribute() {} });
    const document = {
      currentScript: { src: "https://gozenvio.com/widget.js", getAttribute: (k) => attrs[k] ?? null },
      readyState: "complete",
      getElementById: () => null,
      createElement: el,
      body: { appendChild: (a) => appended.push(a) },
    };
    vm.runInNewContext(src, { document, URL });
    return appended[0];
  }
  const a = run({ "data-zenvio-host": "jane-doe" });
  assert.equal(a.href, "https://gozenvio.com/book/jane-doe?src=widget");
  assert.equal(a.rel, "noopener");
  assert.equal(run({ "data-zenvio-host": "../evil" }), undefined);
  assert.equal(run({ "data-zenvio-host": "ok", "data-color": "red;position:absolute" }).style.background, "#365cff");
});
