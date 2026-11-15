"use client";

import { useEffect } from "react";
import {
  applyDocumentTheme,
  readStoredThemeMode,
  resolveTheme,
} from "@/lib/theme";

/** Applies the stored/app theme on public marketing pages (hard load + soft nav). */
export function PublicThemeSync() {
  useEffect(() => {
    const apply = () => {
      const mode = readStoredThemeMode();
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      applyDocumentTheme(mode, resolveTheme(mode, prefersDark));
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return null;
}
