import sharp from "sharp";
import { ApiError } from "./server";

// Reads a raw upload body with a hard size cap, without trusting Content-Length.
export async function readUpload(request: Pick<Request,"headers"|"body">, max: number, label = "file") {
  if (Number(request.headers.get("content-length")) > max + 1024)
    throw new ApiError(`Choose a ${label} under ${Math.round(max / 1000000)} MB.`, 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(`Choose a ${label}.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new ApiError(`Choose a ${label} under ${Math.round(max / 1000000)} MB.`, 413);
    }
    chunks.push(value);
  }
  if (!size) throw new ApiError(`Choose a ${label}.`);
  return Buffer.concat(chunks);
}

// Accepts JPEG, PNG, WebP and PDF by content, not by name. Images are re-encoded, which strips
// metadata such as GPS location; PDFs are stored as uploaded and always served as downloads.
export async function normalizeAttachment(source: Buffer, filename: string) {
  const name = filename.replace(/[^\w .()-]/g, "_").replace(/\s+/g, " ").trim().slice(0, 160) || "attachment";
  if (source.subarray(0, 5).toString("latin1") === "%PDF-")
    return { data: source, contentType: "application/pdf", filename: name.toLowerCase().endsWith(".pdf") ? name : name + ".pdf" };
  try {
    const meta = await sharp(source, { limitInputPixels: 40000000 }).metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format || "")) throw Error("unsupported");
    const data = await sharp(source, { limitInputPixels: 40000000, animated: false })
      .rotate()
      .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { data, contentType: "image/jpeg", filename: name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg" };
  } catch {
    throw new ApiError("Upload a JPEG, PNG, WebP image or a PDF.", 415);
  }
}

export function attachmentResponse(file: { data: Buffer; content_type: string; filename: string }, inline = false) {
  const safe = file.filename.replace(/["\\\r\n]/g, "_");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.content_type,
      "Content-Disposition": `${inline && file.content_type.startsWith("image/") ? "inline" : "attachment"}; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
