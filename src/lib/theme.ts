export const THEME_STORAGE_KEY = "zenvio-theme";
export const themeModes = ["light", "dark", "auto"] as const;
export type ThemeMode = (typeof themeModes)[number];
export type ResolvedTheme = "light" | "dark";

export function parseThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" || value === "auto" ? value : "auto";
}

export function resolveTheme(
  mode: ThemeMode,
  prefersDark: boolean,
): ResolvedTheme {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return prefersDark ? "dark" : "light";
}

function readCookieThemeMode(): ThemeMode | null {
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${THEME_STORAGE_KEY}=([^;]*)`),
    );
    if (!match) return null;
    const value = decodeURIComponent(match[1]);
    return value === "light" || value === "dark" || value === "auto"
      ? value
      : null;
  } catch {
    return null;
  }
}

export function readStoredThemeMode(): ThemeMode {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  return readCookieThemeMode() ?? "auto";
}

export function writeStoredThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* private mode / blocked storage */
  }
  try {
    document.cookie = `${THEME_STORAGE_KEY}=${mode};path=/;max-age=31536000;SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

export function applyDocumentTheme(mode: ThemeMode, resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themeMode = mode;
  root.style.colorScheme = resolved;
}

export function clearDocumentTheme() {
  const root = document.documentElement;
  delete root.dataset.theme;
  delete root.dataset.themeMode;
  root.style.colorScheme = "";
}

/** Blocking snippet for authenticated shells — keeps first paint in sync with storage. */
export const themeBootScript = `(function(){var k=${JSON.stringify(THEME_STORAGE_KEY)};var m=null;try{m=localStorage.getItem(k);}catch(e){}if(m!=="light"&&m!=="dark"&&m!=="auto"){try{var c=document.cookie.match(new RegExp("(?:^|; )"+k+"=([^;]*)"));m=c?decodeURIComponent(c[1]):null;}catch(e){m=null;}}if(m!=="light"&&m!=="dark"&&m!=="auto")m="auto";var d=m==="dark"||(m!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";r.dataset.themeMode=m;r.style.colorScheme=d?"dark":"light";})();`;
