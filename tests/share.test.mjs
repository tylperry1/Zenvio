import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import test from "node:test";
import ts from "typescript";

function load(file) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    filename,
  );
  return m.exports;
}

const {
  canNativeShare,
  copyText,
  shareOrCopy,
  bookingSharePayload,
  emailShareHref,
  smsShareHref,
  shareResultMessage,
} = load("src/lib/share.ts");

test("booking share payload names the host and optional event", () => {
  const profile = bookingSharePayload("https://gozenvio.com/book/ada", "Ada Cole");
  assert.equal(profile.title, "Ada Cole");
  assert.match(profile.text, /Ada Cole/);
  assert.equal(profile.url, "https://gozenvio.com/book/ada");
  const event = bookingSharePayload("https://gozenvio.com/book/ada/intro", "Ada Cole", "Intro call");
  assert.equal(event.title, "Intro call · Ada Cole");
  assert.match(event.text, /Intro call/);
});

test("email and SMS links carry the booking URL", () => {
  const payload = bookingSharePayload("https://gozenvio.com/book/ada", "Ada Cole");
  const mail = emailShareHref(payload);
  assert.match(mail, /^mailto:\?subject=/);
  assert.match(mail, /gozenvio.com%2Fbook%2Fada/);
  const sms = smsShareHref(payload);
  assert.match(sms, /^sms:\?&body=/);
  assert.match(sms, /gozenvio.com%2Fbook%2Fada/);
});

test("native share is used when the browser supports it", async () => {
  const calls = [];
  const nav = {
    share: async (data) => {
      calls.push(data);
    },
    canShare: () => true,
  };
  assert.equal(canNativeShare({ url: "https://gozenvio.com/book/ada" }, nav), true);
  assert.equal(await shareOrCopy({ url: "https://gozenvio.com/book/ada", title: "Ada" }, nav), "shared");
  assert.equal(calls[0].url, "https://gozenvio.com/book/ada");
});

test("cancelling the system share sheet is silent", async () => {
  const nav = {
    share: async () => {
      const error = new Error("dismissed");
      error.name = "AbortError";
      throw error;
    },
    canShare: () => true,
  };
  assert.equal(await shareOrCopy({ url: "https://gozenvio.com/book/ada" }, nav), "cancelled");
  assert.equal(shareResultMessage("cancelled"), "");
});

test("copy is the fallback when share is missing or fails", async () => {
  const written = [];
  const nav = { clipboard: { writeText: async (text) => written.push(text) } };
  assert.equal(canNativeShare({ url: "https://x" }, nav), false);
  assert.equal(await shareOrCopy({ url: "https://gozenvio.com/book/ada" }, nav), "copied");
  assert.deepEqual(written, ["https://gozenvio.com/book/ada"]);
  assert.equal(await copyText("hello", nav), true);
  const failingShare = {
    share: async () => {
      throw new Error("not allowed");
    },
    canShare: () => true,
    clipboard: { writeText: async (text) => written.push(text) },
  };
  assert.equal(await shareOrCopy({ url: "https://gozenvio.com/book/ada" }, failingShare), "copied");
});

test("unavailable copy reports a recovery message", async () => {
  const nav = {
    clipboard: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
  };
  assert.equal(await shareOrCopy({ url: "https://gozenvio.com/book/ada" }, nav), "unavailable");
  assert.match(shareResultMessage("unavailable"), /Select the link/);
  assert.match(shareResultMessage("copied"), /copied/i);
});

test("workspace and marketing booking surfaces expose Share", () => {
  const workspace = fs.readFileSync("src/components/workspace.tsx", "utf8");
  const marketing = fs.readFileSync("src/components/marketing-center.tsx", "utf8");
  const cards = fs.readFileSync("src/components/smart-cards.tsx", "utf8");
  const studio = fs.readFileSync("src/components/profile-studio.tsx", "utf8");
  const onboarding = fs.readFileSync("src/components/onboarding.tsx", "utf8");
  assert.match(workspace, /ShareLinkActions/);
  assert.match(workspace, /Share booking page/);
  assert.match(marketing, /ShareLinkActions/);
  assert.match(cards, /ShareLinkActions/);
  assert.match(studio, /shareOrCopy/);
  assert.match(onboarding, /Share link/);
  const icons = fs.readFileSync("src/components/icons.tsx", "utf8");
  assert.match(icons, /share:/);
});
