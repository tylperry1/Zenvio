import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
const file = path.resolve("src/lib/envelopes.ts"),
  m = new Module(file);
m.filename = file;
m.paths = Module._nodeModulePaths(path.dirname(file));
const original = m.require.bind(m);
m.require = (id) =>
  id === "./document-signing"
    ? {
        signingConsent:
          "I consent to use my typed name as my electronic signature.",
      }
    : id === "./server"
      ? {
          ApiError: class extends Error {},
          string: (s, n, max, min = 1) => {
            if (
              typeof s !== "string" ||
              s.trim().length < min ||
              s.trim().length > max
            )
              throw Error(n);
            return s.trim();
          },
          email: (s) => {
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw Error("email");
            return s.toLowerCase();
          },
        }
      : original(id);
m._compile(
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  file,
);
const { fieldsInput, recipientsInput, preparePdf, manifest, completedPdf } =
  m.exports;
const recipients = [
  { id: "a", name: "A Client", email: "a@example.com" },
  { id: "b", name: "B Client", email: "b@example.com" },
];
const field = (recipient, id) => ({
  id,
  recipient,
  page: 0,
  x: 0.1,
  y: 0.6,
  width: 0.3,
  height: 0.05,
  type: "signature",
  label: "Sign here",
  required: true,
});
test("envelope fields enforce recipient assignments, page boundaries and signatures for everyone", () => {
  const fields = [field("a", "1"), field("b", "2")];
  assert.equal(fieldsInput(fields, recipients, 1).length, 2);
  for (const changed of [
    [field("a", "1")],
    [...fields, field("foreign", "3")],
    [{ ...fields[0], x: 0.9 }, fields[1]],
    [{ ...fields[0], page: 2 }, fields[1]],
    [fields[0], { ...fields[1], id: "1" }],
  ])
    assert.throws(() => fieldsInput(changed, recipients, 1));
});
test("recipient lists reject duplicate identities and excessive recipients", () => {
  assert.throws(() =>
    recipientsInput([
      { name: "A Person", email: "same@example.com" },
      { name: "B Person", email: "SAME@example.com" },
    ]),
  );
  assert.throws(() => recipientsInput(Array(11).fill(recipients[0])));
});
test("PDF validation rejects active content and existing forms", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.catalog.set(
    PDFName.of("OpenAction"),
    pdf.context.obj({
      S: PDFName.of("JavaScript"),
      JS: PDFString.of("alert(1)"),
    }),
  );
  const bytes = await pdf.save();
  await assert.rejects(() => preparePdf(bytes));
  const form = await PDFDocument.create();
  const page = form.addPage();
  form.getForm().createTextField("existing").addToPage(page);
  const formBytes = await form.save();
  await assert.rejects(() => preparePdf(formBytes));
});
test("completed PDF preserves pages, stamps recipient values and appends receipt page", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const prepared = await preparePdf(await pdf.save());
  const fields = [field("a", "1"), field("b", "2")],
    digest = manifest(prepared.bytes, fields, recipients);
  assert.notEqual(
    digest,
    manifest(prepared.bytes, [{ ...fields[0], x: 0.2 }, fields[1]], recipients),
  );
  const result = await completedPdf(
    {
      id: "test",
      pdf: prepared.bytes,
      fields,
      content_hash: digest,
      status: "completed",
    },
    recipients.map((r) => ({
      ...r,
      status: "signed",
      signature_name: r.name,
      signed_at: "2026-10-27T12:00:00Z",
      receipt_hash: "a".repeat(64),
    })),
  );
  assert.equal((await PDFDocument.load(result)).getPageCount(), 2);
});
