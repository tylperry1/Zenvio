import sharp from "sharp";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Upload normalization for Brand Studio artwork. Only bytes uploaded by the
// customer are accepted (never remote URLs). SVGs are sanitized and rasterized.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // within the platform request-body limit
export const MAX_STORED_BYTES = 12_000_000;
const MAX_SIDE = 6000;
const MIN_SIDE = 200;

export class AssetError extends Error {}

/** Rejects SVG features that can execute code, load external resources or expand entities. */
export function unsafeSvgReason(svg: string) {
  if (svg.length > 1_000_000) return "SVG is too large.";
  if (!/<svg[\s>]/i.test(svg)) return "File is not an SVG image.";
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) return "SVG document type declarations are not allowed.";
  if (/<script|<foreignObject|<iframe|<embed|<object|<use[^>]+href\s*=\s*["'](?!#)/i.test(svg)) return "SVG contains embedded scripts or external content.";
  if (/\son[a-z]+\s*=/i.test(svg)) return "SVG contains event handlers.";
  if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(svg)) return "SVG references external files. Embed or outline all artwork before uploading.";
  if (/url\(\s*["']?(?!#)/i.test(svg)) return "SVG references external resources.";
  if (/@import/i.test(svg)) return "SVG stylesheets may not import resources.";
  return null;
}

export async function normalizeArtwork(input: Buffer, filename: string) {
  if (!input.length || input.length > MAX_UPLOAD_BYTES) throw new AssetError("Upload a file up to 4 MB.");
  const head = input.subarray(0, 512).toString("utf8");
  let source: "png" | "jpeg" | "webp" | "svg";
  let pipeline: ReturnType<typeof sharp>;
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) {
    const svg = input.toString("utf8");
    const reason = unsafeSvgReason(svg);
    if (reason) throw new AssetError(reason);
    source = "svg";
    // Rasterize vector artwork at a density that yields roughly 4000px on the long side.
    const probe = await sharp(input, { limitInputPixels: 64_000_000 }).metadata().catch(() => null);
    if (!probe?.width || !probe?.height) throw new AssetError("This SVG could not be read.");
    const density = Math.min(2400, Math.max(72, Math.round((72 * 4000) / Math.max(probe.width, probe.height))));
    pipeline = sharp(input, { density, limitInputPixels: 64_000_000 });
  } else {
    const meta = await sharp(input, { limitInputPixels: 64_000_000 }).metadata().catch(() => null);
    if (!meta || !["png", "jpeg", "webp"].includes(meta.format || "")) throw new AssetError("Upload PNG, JPG, WebP or SVG artwork.");
    if ((meta.pages || 1) > 1) throw new AssetError("Animated images are not supported.");
    source = meta.format as "png" | "jpeg" | "webp";
    pipeline = sharp(input, { limitInputPixels: 64_000_000 }).rotate();
  }
  pipeline = pipeline.toColorspace("srgb").resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true });
  const probe = await pipeline.clone().stats().catch(() => null);
  if (!probe) throw new AssetError("This image could not be processed.");
  const meta = await pipeline.clone().metadata();
  // Alpha is kept only when some pixel is actually transparent.
  const hasAlpha = Boolean(meta.hasAlpha) && !probe.isOpaque;
  let image: Buffer, mime: "image/png" | "image/jpeg";
  if (hasAlpha) {
    image = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    mime = "image/png";
  } else {
    image = await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
    mime = "image/jpeg";
  }
  const out = await sharp(image).metadata();
  if (!out.width || !out.height) throw new AssetError("This image could not be processed.");
  if (Math.min(out.width, out.height) < MIN_SIDE) throw new AssetError(`Artwork must be at least ${MIN_SIDE}px on its shortest side for print.`);
  if (image.length > MAX_STORED_BYTES) throw new AssetError("The processed image is too large. Reduce its dimensions.");
  return {
    image,
    mime,
    width: out.width,
    height: out.height,
    hasAlpha,
    source,
    sha256: createHash("sha256").update(image).digest("hex"),
    filename: filename.replace(/[^\w .()-]/g, "").slice(0, 200),
  };
}

// ---------- Signed print-file URLs for the supplier ----------
function signingKey() {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("A signing secret is not configured.");
  return createHash("sha256").update("zenvio-print-file:" + secret).digest();
}
export function signPrintFile(proofId: string, expiresAt: number) {
  return createHmac("sha256", signingKey()).update(`${proofId}.${expiresAt}`).digest("base64url");
}
export function printFileUrl(origin: string, proofId: string, ttlSeconds = 30 * 86400) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${origin.replace(/\/$/, "")}/api/marketplace/print-files?id=${proofId}&exp=${exp}&sig=${signPrintFile(proofId, exp)}`;
}
export function verifyPrintFile(proofId: string, exp: string | null, sig: string | null) {
  if (!exp || !sig || !/^\d{10}$/.test(exp) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  const expected = Buffer.from(signPrintFile(proofId, Number(exp)));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
