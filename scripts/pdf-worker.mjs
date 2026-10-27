import { copyFileSync, mkdirSync, cpSync } from "node:fs";
mkdirSync("public", { recursive: true });
copyFileSync(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "public/pdf.worker.min.mjs",
);

for (const name of ["standard_fonts", "cmaps", "wasm"])
  cpSync("node_modules/pdfjs-dist/" + name, "public/pdf-assets/" + name, {
    recursive: true,
  });
