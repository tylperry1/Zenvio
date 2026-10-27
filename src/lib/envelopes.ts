import { PDFDocument, StandardFonts, PDFName, rgb } from "pdf-lib";
import { createHash } from "node:crypto";
import { ApiError, string, email } from "./server";
import { signingConsent } from "./document-signing";
export type Field = {
  id: string;
  recipient: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "signature" | "initials" | "date" | "text";
  label: string;
  required: boolean;
};
export type Recipient = {
  id: string;
  name: string;
  email: string;
  status: string;
  signature_name?: string;
  signed_at?: string;
  receipt_hash?: string;
  answers?: Record<string, string>;
};
export const hash = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
export async function preparePdf(bytes: Uint8Array) {
  if (
    bytes.length > 3000000 ||
    Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
  )
    throw new ApiError("Upload a PDF smaller than 3 MB.");
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch {
    throw new ApiError("This PDF cannot be opened. Use an unencrypted PDF.");
  }
  if (pdf.getPageCount() < 1 || pdf.getPageCount() > 30)
    throw new ApiError("Use a PDF with 1–30 pages.");
  const forbidden = [
    "JavaScript",
    "JS",
    "OpenAction",
    "AA",
    "Launch",
    "EmbeddedFiles",
    "RichMedia",
    "XFA",
  ];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if ("keys" in object && typeof object.keys === "function") {
      const keys = object.keys() as PDFName[];
      if (keys.some((k) => forbidden.includes(k.decodeText())))
        throw new ApiError(
          "Export a plain PDF without scripts, actions, or embedded files.",
        );
    }
  }
  if (pdf.getForm().getFields().length)
    throw new ApiError(
      "Flatten existing form fields before uploading this PDF.",
    );
  const pages = pdf.getPages().map((p) => {
    if (p.getRotation().angle !== 0)
      throw new ApiError("Export PDF pages without rotation before uploading.");
    const { width, height } = p.getSize();
    if (width < 100 || height < 100 || width > 3000 || height > 3000)
      throw new ApiError("Unsupported PDF page size.");
    return { width, height };
  });
  return { bytes: Buffer.from(await pdf.save()), pages };
}
export function recipientsInput(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 10)
    throw new ApiError("Add 1–10 recipients.");
  const rows = value.map((r) => ({
    name: string(r.name, "recipient name", 100, 2),
    email: email(r.email),
  }));
  if (new Set(rows.map((r) => r.email)).size !== rows.length)
    throw new ApiError("Each recipient must have a different email.");
  return rows;
}
export function fieldsInput(
  value: unknown,
  recipients: Recipient[],
  pageCount: number,
): Field[] {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw new ApiError("Place 1–100 fields on the PDF.");
  const fields = value.map((f) => {
    if (
      !f ||
      !["signature", "initials", "date", "text"].includes(f.type) ||
      !recipients.some((r) => r.id === f.recipient) ||
      !Number.isInteger(f.page) ||
      f.page < 0 ||
      f.page >= pageCount
    )
      throw new ApiError("Invalid field assignment.");
    for (const key of ["x", "y", "width", "height"])
      if (
        typeof f[key] !== "number" ||
        !Number.isFinite(f[key]) ||
        f[key] < 0 ||
        f[key] > 1
      )
        throw new ApiError("Invalid field position.");
    if (
      f.width < 0.06 ||
      f.height < 0.015 ||
      f.x + f.width > 1.001 ||
      f.y + f.height > 1.001
    )
      throw new ApiError("Keep fields inside the page.");
    return {
      id: string(f.id, "field ID", 64),
      recipient: f.recipient,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      type: f.type,
      label: string(f.label || f.type, "field label", 80),
      required: f.required !== false,
    } as Field;
  });
  if (new Set(fields.map((f) => f.id)).size !== fields.length)
    throw new ApiError("Duplicate field IDs.");
  if (
    recipients.some(
      (r) =>
        !fields.some(
          (f) => f.recipient === r.id && f.type === "signature" && f.required,
        ),
    )
  )
    throw new ApiError("Place a required signature for every recipient.");
  return fields;
}
export function manifest(
  pdf: Uint8Array,
  fields: Field[],
  recipients: Recipient[],
) {
  return hash(
    JSON.stringify({
      pdf: hash(pdf),
      fields,
      recipients: recipients.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
      })),
    }),
  );
}
const safe = (s: string) => s.replace(/[^\x20-\x7e]/g, "?");
export async function completedPdf(envelope: any, recipients: Recipient[]) {
  const pdf = await PDFDocument.load(envelope.pdf),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  for (const f of envelope.fields as Field[]) {
    const r = recipients.find((r) => r.id === f.recipient);
    if (r?.status !== "signed") continue;
    const page = pdf.getPage(f.page),
      { width, height } = page.getSize();
    const text =
      f.type === "signature"
        ? r.signature_name || ""
        : f.type === "initials"
          ? (r.signature_name || "")
              .split(/\s+/)
              .map((s) => s[0])
              .join("")
          : f.type === "date"
            ? new Date(r.signed_at!).toISOString().slice(0, 10)
            : r.answers?.[f.id] || "";
    const face = f.type === "signature" ? italic : font;
    const value = safe(text);
    const size = Math.min(
      f.height * height * 0.6,
      (f.width * width) / Math.max(face.widthOfTextAtSize(value, 1), 1),
      18,
    );
    page.drawText(value, {
      x: f.x * width,
      y: height - (f.y + f.height) * height + f.height * height * 0.25,
      size,
      font: face,
      color: rgb(0.08, 0.14, 0.28),
    });
  }
  let page = pdf.addPage(),
    y = 790;
  const line = (s: string, size = 10) => {
    if (y < 45) {
      page = pdf.addPage();
      y = 790;
    }
    page.drawText(safe(s), { x: 40, y, size, font });
    y -= size + 8;
  };
  line("Zenvio | Signing record", 20);
  line("Envelope " + envelope.id);
  line("Agreement SHA-256:", 10);
  line(envelope.content_hash, 8);
  line("Status: " + envelope.status);
  line("Private-link access and self-attested typed signatures.");
  line("Email ownership and identity are not independently verified.");
  line("Electronic signing consent:", 10);
  for (const chunk of signingConsent.match(/.{1,85}(?:\s|$)/g) || [])
    line(chunk.trim(), 9);
  for (const r of recipients) {
    y -= 12;
    line(r.name + " <" + r.email + ">");
    line("Status: " + r.status);
    if (r.signed_at) {
      line("Signed by: " + r.signature_name);
      line("UTC: " + new Date(r.signed_at).toISOString());
      line("Receipt SHA-256:", 9);
      line(r.receipt_hash || "", 8);
    }
  }
  return Buffer.from(await pdf.save());
}
