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

function ThemeProviderInner({ children }: { children: ReactNode }) {
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
      // Only the outermost authenticated provider owns the document theme.
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

/** Nest-safe: nested shells reuse the authenticated root provider. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const parent = useContext(ThemeContext);
  if (parent) return <>{children}</>;
  return <ThemeProviderInner>{children}</ThemeProviderInner>;
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
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  function closeMenu(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    const menuEl = menu.current;
    const rootEl = root.current;
    const items = () =>
      Array.from(
        menuEl?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ||
          [],
      );
    const selected =
      items().find((item) => item.getAttribute("aria-checked") === "true") ||
      items()[0];
    selected?.focus();

    const onPointer = (e: MouseEvent) => {
      if (!rootEl?.contains(e.target as Node)) closeMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      if (!list.length) return;
      const index = list.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu(true);
        return;
      }
      if (e.key === "Tab") {
        // Let Tab move focus out; focusout closes without stealing focus back.
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        list[(Math.max(index, 0) + 1) % list.length]?.focus();
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        list[(Math.max(index, 0) - 1 + list.length) % list.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        list[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        list[list.length - 1]?.focus();
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && rootEl?.contains(next)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    rootEl?.addEventListener("keydown", onKey);
    rootEl?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      rootEl?.removeEventListener("keydown", onKey);
      rootEl?.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  return (
    <div className="shell-theme" ref={root}>
      <button
        ref={trigger}
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
        <div
          ref={menu}
          className="shell-theme-menu"
          role="menu"
          aria-label="Theme"
        >
          {themeModes.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={mode === option}
              className={mode === option ? "active" : undefined}
              onClick={() => {
                setMode(option);
                closeMenu();
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
