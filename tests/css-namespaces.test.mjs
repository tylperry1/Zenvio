import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// The landing page owns the .mk-* class namespace (src/app/marketing.css).
// Global stylesheets must not define .mk-* selectors, or they leak into it.
test("global stylesheets do not reuse the landing page's .mk- namespace", () => {
  const landing = fs.readFileSync("src/app/marketing.css", "utf8");
  const owned = new Set(landing.match(/\.mk-[a-z0-9-]+/g));
  for (const file of fs.readdirSync("src/app").filter((f) => f.endsWith(".css") && f !== "marketing.css")) {
    const css = fs.readFileSync(`src/app/${file}`, "utf8");
    const clashes = [...new Set(css.match(/\.mk-[a-z0-9-]+/g) || [])].filter((c) => owned.has(c));
    assert.deepEqual(clashes, [], `${file} redefines landing classes: ${clashes.join(", ")}`);
  }
});
