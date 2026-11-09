import { useEffect, useState } from "react";
import {
  applyPreference,
  loadPreference,
  nextPreference,
  savePreference,
  type ThemePreference,
} from "../lib/theme";

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(loadPreference);

  useEffect(() => {
    applyPreference(preference);
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => applyPreference("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  return (
    <button
      type="button"
      className="text-sm hover:text-accent"
      onClick={() => {
        const next = nextPreference(preference);
        savePreference(next);
        setPreference(next);
      }}
    >
      Theme: {preference}
    </button>
  );
}
