import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, verify } from "node:crypto";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const fixture = { id: "9fb8cb60-9c42-4800-8bbd-6af86ccb274b", slug: "card-fixture", displayName: "Fixture Name", company: "Fixture Business", jobTitle: "Owner", accent: "#365CFF" };
const url = new URL("https://gozenvio.com/p/card-fixture?via=qr");

function loadWallet(credentials = {}) {
  const filename = path.resolve("src/lib/smart-wallet.ts");
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const load = module.require.bind(module);
  module.require = (id) => ({
    "./platform-settings": { integrationValue: async (key) => credentials[key] ?? "" },
    "./server": { ApiError: Error },
    "./db": { getPool: () => { throw new Error("Unexpected database access"); } },
  })[id] ?? load(id);
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
  return module.exports;
}

test("Google save link signs a stable Generic Object reference with the service key", () => {
  const wallet = loadWallet();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const object = wallet.googleWalletObject(fixture, url, "12345.zenvio");
  assert.match(object.id, /^12345\.smart-[0-9a-f]{32}$/);
  assert.equal(wallet.googleWalletObject({ ...fixture, displayName: "Updated" }, url, "12345.zenvio").id, object.id);
  assert.equal(object.barcode.value, url.href);
  assert.equal(object.linksModuleData.uris[0].uri, url.href);
  const link = new URL(wallet.signGoogleWalletLink("service@example.test", privateKey, url.origin, object.id));
  assert.equal(link.origin, "https://pay.google.com");
  const [header, payload, signature] = link.pathname.split("/").at(-1).split(".");
  assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.typ, "savetowallet");
  assert.equal(claims.aud, "google");
  assert.deepEqual(claims.payload, { genericObjects: [{ id: object.id }] });
});

test("Apple creates a QR pass with a manifest and a verifiable detached signature", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zenvio-pass-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const openssl = (...args) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=Fixture CA",
    "-addext", "basicConstraints=critical,CA:TRUE", "-out", "ca.pem", "-keyout", "ca.key");
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=Pass Fixture/UID=pass.com.gozenvio.fixture/OU=FIXTURE123",
    "-out", "signer.csr", "-keyout", "signer.key");
  openssl("x509", "-req", "-in", "signer.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-days", "1", "-out", "signer.pem");
  const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");
  const keys = {
    APPLE_WALLET_PASS_TYPE_ID: "pass.com.gozenvio.fixture",
    APPLE_WALLET_TEAM_ID: "FIXTURE123",
    APPLE_WALLET_SIGNER_CERT: read("signer.pem"),
    APPLE_WALLET_SIGNER_KEY: read("signer.key").replaceAll("\n", "\\n"),
    APPLE_WALLET_WWDR_CERT: read("ca.pem"),
  };
  const buffer = await loadWallet(keys).appleWalletPass(fixture, url);
  fs.writeFileSync(path.join(dir, "card.pkpass"), buffer);
  execFileSync("unzip", ["-q", "card.pkpass"], { cwd: dir });
  const pass = JSON.parse(read("pass.json"));
  assert.match(pass.serialNumber, /^smart-[0-9a-f]{32}$/);
  assert.equal(pass.barcodes[0].message, url.href);
  assert.equal(pass.generic.primaryFields[0].value, fixture.displayName);
  assert.ok(JSON.parse(read("manifest.json"))["icon@3x.png"]);
  openssl("cms", "-verify", "-inform", "DER", "-in", "signature", "-content", "manifest.json", "-CAfile", "ca.pem", "-purpose", "any", "-binary");
  await assert.rejects(loadWallet({ ...keys, APPLE_WALLET_TEAM_ID: "OTHERID123" }).appleWalletPass(fixture, url));
  await assert.rejects(loadWallet({ ...keys, APPLE_WALLET_SIGNER_KEY: read("ca.key") }).appleWalletPass(fixture, url));
});
