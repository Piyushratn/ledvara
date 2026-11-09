export type ThemePreference = "system" | "light" | "dark";

export const THEME_KEY = "ledvara-theme";
const ORDER = ["system", "light", "dark"] as const;

export function nextPreference(current: ThemePreference): ThemePreference {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? "system";
}

export function parsePreference(raw: unknown): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): "light" | "dark" {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function loadPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function savePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Private mode or blocked storage: the theme just won't persist.
  }
}

export function applyPreference(preference: ThemePreference): void {
  const dark = resolveTheme(preference, systemPrefersDark()) === "dark";
  document.documentElement.classList.toggle("dark", dark);
}
