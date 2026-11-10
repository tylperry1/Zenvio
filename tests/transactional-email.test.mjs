import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import ts from "typescript";
const module = new Module("transactional-email.ts");
module._compile(ts.transpileModule(fs.readFileSync("src/lib/transactional-email.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, "transactional-email.ts");
test("transactional branding escapes customer input and uses only platform URLs for its CTA", () => {
  const html = module.exports.transactionalEmail('Hello <img src=x onerror="bad()">', 'Message <script>bad()</script>\n\nhttps://external.example/steal');
  assert.doesNotMatch(html, /<script>|<img|href="https:\/\/external/);
  assert.match(html, /&lt;script&gt;/);
  const link = module.exports.transactionalEmail("Your booking", "https://gozenvio.com/reschedule#token=fixture");
  assert.match(link, /href="https:\/\/gozenvio.com\/reschedule#token=fixture"/);
});

test("team invitation email uses its private acceptance link", () => {
  const url = module.exports.platformOrigin() + "/team/accept#token=fixture";
  const html = module.exports.transactionalEmail("You’re invited to join a team on Zenvio", url);
  assert.ok(html.includes(`href="${url}"`));
  assert.match(html, />Join your team<\/a>/);
});
