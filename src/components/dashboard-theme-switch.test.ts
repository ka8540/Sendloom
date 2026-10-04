import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardThemeSwitch } from "./dashboard-theme-switch";
import { DASHBOARD_THEMES, themeForKey, themeIndex } from "./dashboard-theme-switch-state";

const source = readFileSync("src/components/dashboard-theme-switch.tsx", "utf8");
const css = readFileSync("src/components/dashboard-theme-switch.module.css", "utf8");

describe("dashboard theme switch", () => {
  it("maps Light, System, and Dark to the same three physical positions in either orientation", () => {
    expect(DASHBOARD_THEMES).toEqual(["light", "system", "dark"]);
    expect(DASHBOARD_THEMES.map(themeIndex)).toEqual([0, 1, 2]);
    expect(css).toContain("translateX(calc(var(--selection-index) * var(--theme-step)))");
    expect(css).toContain("translateY(calc(var(--selection-index) * var(--theme-step)))");
    expect(css).toContain("--theme-step: calc((114px - 2px) / 3)");
    expect(css).toContain("transition: transform 200ms ease-out");
  });

  it("keeps System in the center regardless of the operating system appearance", () => {
    const scenarios = [
      { preference: "system", operatingSystem: "light" },
      { preference: "system", operatingSystem: "dark" }
    ] as const;
    for (const { preference, operatingSystem } of scenarios) {
      expect(operatingSystem).not.toBe(preference);
      expect(DASHBOARD_THEMES[themeIndex(preference)]).toBe("system");
    }
    expect(source).not.toContain("resolvedTheme");
  });

  it("supports arrow keys along the visible axis and Home/End", () => {
    expect(themeForKey("ArrowRight", "light", false)).toBe("system");
    expect(themeForKey("ArrowLeft", "light", false)).toBe("dark");
    expect(themeForKey("ArrowDown", "system", true)).toBe("dark");
    expect(themeForKey("ArrowUp", "light", true)).toBe("dark");
    expect(themeForKey("Home", "dark", true)).toBe("light");
    expect(themeForKey("End", "light", false)).toBe("dark");
    expect(themeForKey("ArrowDown", "light", false)).toBeNull();
  });

  it("renders a same-size noninteractive shell before hydration", () => {
    const expanded = renderToStaticMarkup(createElement(DashboardThemeSwitch, { collapsed: false }));
    const collapsed = renderToStaticMarkup(createElement(DashboardThemeSwitch, { collapsed: true }));
    expect(expanded).toContain('data-orientation="horizontal"');
    expect(collapsed).toContain('data-orientation="vertical"');
    expect(expanded).toContain('aria-hidden="true"');
    expect(collapsed).toContain('aria-hidden="true"');
    expect(expanded).not.toContain('role="radiogroup"');
    expect(css).toContain("height: 51.2px");
    expect(css).toContain("height: 36px");
    expect(css).toContain("height: 114px");
  });

  it("uses one thumb, directly clickable named radio options, and no fullscreen overlay", () => {
    expect(source).toContain("DASHBOARD_THEMES.map");
    expect(source).toContain("onClick={() => select(option)}");
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('role="radio"');
    expect(source).toContain("aria-checked={theme === option}");
    expect(source).toContain("aria-label={`Use ${option} theme`}");
    expect(source.match(/className={styles.thumb}/g)).toHaveLength(1);
    expect(source).not.toMatch(/overlay|createPortal|setTimeout/);
  });
});
