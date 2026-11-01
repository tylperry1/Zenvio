// Brand Studio design model and validation. Pure: no database or network.
// Coordinates are fractions of a print area's trim box (0–1 from top-left);
// x/y are the layer's centre. Production files are generated from this model,
// never from a browser screenshot.

export const STUDIO_FONTS = {
  sans: { label: "Sans", css: "Helvetica, Arial, sans-serif", weight: 400 },
  "sans-bold": { label: "Sans Bold", css: "Helvetica, Arial, sans-serif", weight: 700 },
  serif: { label: "Serif", css: "'Times New Roman', Times, serif", weight: 400 },
  "serif-bold": { label: "Serif Bold", css: "'Times New Roman', Times, serif", weight: 700 },
  mono: { label: "Mono", css: "'Courier New', Courier, monospace", weight: 400 },
  "mono-bold": { label: "Mono Bold", css: "'Courier New', Courier, monospace", weight: 700 },
} as const;
export type StudioFont = keyof typeof STUDIO_FONTS;

export const FILE_TYPES = ["default", "front", "back", "inside", "neck-inner", "neck-outer", "sleeve-left", "sleeve-right"] as const;

export type PrintArea = {
  key: string;
  label: string;
  file_type: (typeof FILE_TYPES)[number];
  width_mm: number;
  height_mm: number;
  bleed_mm: number;
  safe_mm: number;
  min_dpi: number;
};
export type ImageLayer = { id: string; type: "image"; assetId: string; x: number; y: number; w: number };
export type TextLayer = { id: string; type: "text"; text: string; font: StudioFont; color: string; size: number; x: number; y: number; align: "left" | "center" | "right" };
export type Layer = ImageLayer | TextLayer;
export type DesignConfig = { areas: Record<string, Layer[]> };
export type AssetInfo = { id: string; width: number; height: number; has_alpha: boolean };

export class DesignError extends Error {}

const num = (v: unknown, min: number, max: number, name: string) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new DesignError(`Invalid ${name}.`);
  return Math.round(v * 10000) / 10000;
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
// Characters representable in the embedded PDF standard fonts (WinAnsi subset).
export const PRINTABLE_TEXT = /^[\x20-\x7E -ÿ‘’“”–—•…€™]*$/;

export function parsePrintAreas(value: unknown): PrintArea[] {
  if (!Array.isArray(value) || value.length > 8) throw new DesignError("Use up to eight print areas.");
  const areas = value.map((a: any) => {
    if (!a || typeof a !== "object") throw new DesignError("Invalid print area.");
    const key = typeof a.key === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(a.key) ? a.key : null;
    if (!key) throw new DesignError("Print area keys use lowercase letters, numbers and hyphens.");
    const file_type = FILE_TYPES.includes(a.file_type) ? a.file_type : null;
    if (!file_type) throw new DesignError(`Choose a supplier file type for ${key}.`);
    const label = typeof a.label === "string" && a.label.trim() ? a.label.trim().slice(0, 40) : key;
    return {
      key,
      label,
      file_type,
      width_mm: num(a.width_mm, 10, 2000, "print width"),
      height_mm: num(a.height_mm, 10, 2000, "print height"),
      bleed_mm: num(a.bleed_mm ?? 0, 0, 20, "bleed"),
      safe_mm: num(a.safe_mm ?? 0, 0, 50, "safe zone"),
      min_dpi: Math.round(num(a.min_dpi ?? 150, 72, 600, "minimum DPI")),
    } as PrintArea;
  });
  if (new Set(areas.map((a) => a.key)).size !== areas.length) throw new DesignError("Print area keys must be distinct.");
  if (new Set(areas.map((a) => a.file_type)).size !== areas.length) throw new DesignError("Each print area needs its own supplier file type.");
  return areas;
}

export function parseDesign(value: unknown, areas: PrintArea[]): DesignConfig {
  const raw = (value as any)?.areas;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DesignError("Invalid design.");
  const result: DesignConfig = { areas: {} };
  for (const [key, layers] of Object.entries(raw)) {
    if (!areas.some((a) => a.key === key)) throw new DesignError(`This product has no "${key}" print area.`);
    if (!Array.isArray(layers) || layers.length > 10) throw new DesignError("Use up to ten layers per print area.");
    result.areas[key] = layers.map((l: any, i): Layer => {
      const id = typeof l?.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(l.id) ? l.id : `l${i}`;
      if (l?.type === "image") {
        if (typeof l.assetId !== "string" || !UUID.test(l.assetId)) throw new DesignError("Invalid artwork reference.");
        return { id, type: "image", assetId: l.assetId, x: num(l.x, -0.5, 1.5, "position"), y: num(l.y, -0.5, 1.5, "position"), w: num(l.w, 0.02, 1.5, "artwork size") };
      }
      if (l?.type === "text") {
        const text = typeof l.text === "string" ? l.text.replace(/\s+/g, " ").trim() : "";
        if (!text || text.length > 120) throw new DesignError("Text layers need 1–120 characters.");
        if (!PRINTABLE_TEXT.test(text)) throw new DesignError("Text contains characters that cannot be printed with the available fonts. Use standard Latin letters, numbers and punctuation.");
        if (!Object.hasOwn(STUDIO_FONTS, l.font)) throw new DesignError("Choose a supported font.");
        if (typeof l.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(l.color)) throw new DesignError("Choose a valid text color.");
        const align = l.align === "left" || l.align === "right" ? l.align : "center";
        return { id, type: "text", text, font: l.font, color: l.color.toLowerCase(), size: num(l.size, 0.02, 0.5, "text size"), x: num(l.x, -0.5, 1.5, "position"), y: num(l.y, -0.5, 1.5, "position"), align };
      }
      throw new DesignError("Unknown layer type.");
    });
  }
  return result;
}

/** Layer height as a fraction of the area's height (images keep their aspect ratio). */
export function imageHeightFraction(layer: ImageLayer, asset: AssetInfo, area: PrintArea) {
  return layer.w * (asset.height / asset.width) * (area.width_mm / area.height_mm);
}
export function effectiveDpi(layer: ImageLayer, asset: AssetInfo, area: PrintArea) {
  const inches = (layer.w * area.width_mm) / 25.4;
  return Math.floor(asset.width / inches);
}

export type Validation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  areas: Record<string, { minDpi: number | null; layers: number }>;
};

/** Checks a design against the supplier print specification and the customer's assets. */
export function validateDesign(design: DesignConfig, areas: PrintArea[], assets: Map<string, AssetInfo>): Validation {
  const errors: string[] = [], warnings: string[] = [], summary: Validation["areas"] = {};
  let total = 0;
  for (const area of areas) {
    const layers = design.areas[area.key] || [];
    total += layers.length;
    let minDpi: number | null = null;
    const bleedX = area.bleed_mm / area.width_mm, bleedY = area.bleed_mm / area.height_mm;
    const safeX = area.safe_mm / area.width_mm, safeY = area.safe_mm / area.height_mm;
    for (const layer of layers) {
      let half: { w: number; h: number };
      if (layer.type === "image") {
        const asset = assets.get(layer.assetId);
        if (!asset) {
          errors.push(`${area.label}: artwork is missing or no longer available.`);
          continue;
        }
        half = { w: layer.w / 2, h: imageHeightFraction(layer, asset, area) / 2 };
        const dpi = effectiveDpi(layer, asset, area);
        minDpi = minDpi === null ? dpi : Math.min(minDpi, dpi);
        const hard = Math.min(100, area.min_dpi);
        if (dpi < hard) errors.push(`${area.label}: artwork resolution is ${dpi} DPI at this size; at least ${hard} DPI is required. Make it smaller or upload a larger file.`);
        else if (dpi < area.min_dpi) warnings.push(`${area.label}: artwork is ${dpi} DPI at this size; ${area.min_dpi} DPI or more is recommended for sharp printing.`);
        if (!asset.has_alpha) warnings.push(`${area.label}: an image has no transparent background, so its background will print as part of the design.`);
      } else {
        // Approximate text box: average glyph width ≈ 0.55 × size (relative to height).
        const ratio = area.height_mm / area.width_mm;
        half = { w: Math.min(3, layer.text.length * layer.size * 0.55 * ratio) / 2, h: layer.size / 2 };
      }
      const left = layer.x - half.w, right = layer.x + half.w, top = layer.y - half.h, bottom = layer.y + half.h;
      if (right <= -bleedX || left >= 1 + bleedX || bottom <= -bleedY || top >= 1 + bleedY) errors.push(`${area.label}: a layer is entirely outside the printable area.`);
      else if (left < -bleedX - 0.001 || right > 1 + bleedX + 0.001 || top < -bleedY - 0.001 || bottom > 1 + bleedY + 0.001) warnings.push(`${area.label}: part of a layer extends beyond the printable area and will be cropped.`);
      else if (left < safeX || right > 1 - safeX || top < safeY || bottom > 1 - safeY) warnings.push(`${area.label}: a layer is outside the safe zone and may be trimmed.`);
    }
    summary[area.key] = { minDpi, layers: layers.length };
  }
  if (!total) errors.push("Add artwork or text to at least one print area.");
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], areas: summary };
}
