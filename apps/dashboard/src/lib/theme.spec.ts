// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPreference,
  loadPreference,
  nextPreference,
  parsePreference,
  resolveTheme,
  savePreference,
} from "./theme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("theme", () => {
  it("cycles system, light, dark and back", () => {
    expect(nextPreference("system")).toBe("light");
    expect(nextPreference("light")).toBe("dark");
    expect(nextPreference("dark")).toBe("system");
  });

  it("resolves 'system' from the OS setting and otherwise obeys the choice", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("treats anything unknown as 'system'", () => {
    expect(parsePreference("dark")).toBe("dark");
    expect(parsePreference("purple")).toBe("system");
    expect(parsePreference(null)).toBe("system");
  });

  it("saves and loads the preference and toggles the dark class", () => {
    expect(loadPreference()).toBe("system");
    savePreference("dark");
    expect(loadPreference()).toBe("dark");

    applyPreference("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyPreference("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
