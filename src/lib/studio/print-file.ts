import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createHash } from "node:crypto";
import { imageHeightFraction, type DesignConfig, type PrintArea } from "./design";

// Generates a production PDF per print area at the supplier's physical size
// (trim + bleed). Artwork is embedded at its full stored resolution and text
// uses embedded standard PDF fonts, so output does not depend on system fonts.

const PT_PER_MM = 72 / 25.4;
const fonts = {
  sans: StandardFonts.Helvetica,
  "sans-bold": StandardFonts.HelveticaBold,
  serif: StandardFonts.TimesRoman,
  "serif-bold": StandardFonts.TimesRomanBold,
  mono: StandardFonts.Courier,
  "mono-bold": StandardFonts.CourierBold,
} as const;

export type AssetData = { id: string; width: number; height: number; has_alpha: boolean; mime: string; image: Buffer };

export async function renderPrintFile(area: PrintArea, design: DesignConfig, assets: Map<string, AssetData>) {
  const layers = design.areas[area.key] || [];
  const doc = await PDFDocument.create();
  doc.setTitle(`Zenvio print file – ${area.label}`);
  doc.setProducer("Zenvio Brand Studio");
  doc.setCreator("Zenvio Brand Studio");
  const bleed = area.bleed_mm * PT_PER_MM;
  const trimW = area.width_mm * PT_PER_MM, trimH = area.height_mm * PT_PER_MM;
  const page = doc.addPage([trimW + 2 * bleed, trimH + 2 * bleed]);
  page.setTrimBox(bleed, bleed, trimW, trimH);
  const embedded = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  for (const layer of layers) {
    if (layer.type === "image") {
      const asset = assets.get(layer.assetId);
      if (!asset) throw new Error("missing_asset");
      let image = embedded.get(asset.id);
      if (!image) {
        image = asset.mime === "image/jpeg" ? await doc.embedJpg(asset.image) : await doc.embedPng(asset.image);
        embedded.set(asset.id, image);
      }
      const w = layer.w * trimW;
      const h = imageHeightFraction(layer, asset, area) * trimH;
      const cx = bleed + layer.x * trimW, cy = bleed + (1 - layer.y) * trimH;
      page.drawImage(image, { x: cx - w / 2, y: cy - h / 2, width: w, height: h });
    } else {
      const font = await doc.embedFont(fonts[layer.font]);
      const size = layer.size * trimH;
      const width = font.widthOfTextAtSize(layer.text, size);
      const cx = bleed + layer.x * trimW, cy = bleed + (1 - layer.y) * trimH;
      const x = layer.align === "left" ? cx : layer.align === "right" ? cx - width : cx - width / 2;
      // Vertically centre on cap height so the preview and file agree.
      const baseline = cy - font.heightAtSize(size, { descender: false }) / 2;
      const hex = layer.color.slice(1);
      page.drawText(layer.text, {
        x,
        y: baseline,
        size,
        font,
        color: rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255),
      });
    }
  }
  const bytes = Buffer.from(await doc.save());
  return { file: bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
