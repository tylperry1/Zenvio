"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./icons";
import {
  applyDocumentTheme,
  clearDocumentTheme,
  parseThemeMode,
  readStoredThemeMode,
  resolveTheme,
  themeModes,
  writeStoredThemeMode,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/theme";

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("auto");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const initial = readStoredThemeMode();
    const next = resolveTheme(initial, systemPrefersDark());
    modeRef.current = initial;
    setModeState(initial);
    setResolved(next);
    applyDocumentTheme(initial, next);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const current = modeRef.current;
      const value = resolveTheme(current, media.matches);
      setResolved(value);
      applyDocumentTheme(current, value);
    };
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
      clearDocumentTheme();
    };
  }, []);

  function setMode(next: ThemeMode) {
    const mode = parseThemeMode(next);
    const value = resolveTheme(mode, systemPrefersDark());
    writeStoredThemeMode(mode);
    modeRef.current = mode;
    setModeState(mode);
    setResolved(value);
    applyDocumentTheme(mode, value);
  }

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeControl requires ThemeProvider");
  return value;
}

const labels: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  auto: "Auto",
};

const icons: Record<ThemeMode, string> = {
  light: "sun",
  dark: "moon",
  auto: "monitor",
};

export function ThemeControl() {
  const { mode, resolved, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="shell-theme" ref={root}>
      <button
        type="button"
        className="shell-icon-button"
        aria-label={`Theme: ${labels[mode]}${mode === "auto" ? ` (${resolved})` : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Theme"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={icons[mode === "auto" ? resolved : mode]} size={18} />
      </button>
      {open && (
        <div className="shell-theme-menu" role="menu" aria-label="Theme">
          {themeModes.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={mode === option}
              className={mode === option ? "active" : undefined}
              onClick={() => {
                setMode(option);
                setOpen(false);
              }}
            >
              <Icon name={icons[option]} size={16} />
              <span>{labels[option]}</span>
              {mode === option && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
