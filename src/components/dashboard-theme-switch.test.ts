import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardThemeSwitch } from "./dashboard-theme-switch";
import { resolvesToDark } from "./dashboard-theme-switch-state";

const source = readFileSync("src/components/dashboard-theme-switch.tsx", "utf8");
const css = readFileSync("src/components/dashboard-theme-switch.module.css", "utf8");

describe("dashboard theme switch", () => {
  it("resolves a saved System preference from the operating system", () => {
    expect(resolvesToDark("system", false)).toBe(false);
    expect(resolvesToDark("system", true)).toBe(true);
    expect(resolvesToDark("light", true)).toBe(false);
    expect(resolvesToDark("dark", false)).toBe(true);
  });

  it("keeps one thumb that moves 44px between the two icons", () => {
    expect(source.match(/className={styles.thumb}/g)).toHaveLength(1);
    expect(css).toContain("translateX(44px)");
    expect(css).toContain("translateY(44px)");
    expect(css).toContain("transition: transform 200ms ease-out");
  });

  it("renders a same-size noninteractive shell before hydration", () => {
    const expanded = renderToStaticMarkup(createElement(DashboardThemeSwitch, { collapsed: false }));
    const collapsed = renderToStaticMarkup(createElement(DashboardThemeSwitch, { collapsed: true }));
    expect(expanded).toContain('data-orientation="horizontal"');
    expect(collapsed).toContain('data-orientation="vertical"');
    expect(expanded).toContain('aria-hidden="true"');
    expect(collapsed).toContain('aria-hidden="true"');
    expect(expanded).not.toContain('role="switch"');
    expect(css).toContain("width: 80px");
    expect(css).toContain("height: 36px");
  });

  it("toggles only Light and Dark with switch semantics and no page overlay", () => {
    expect(source).toContain('role="switch"');
    expect(source).toContain("aria-checked={checked}");
    expect(source).toContain('nextChecked ? "dark" : "light"');
    expect(source).toContain("onClick={handleCheckedChange}");
    expect(source).not.toMatch(/Monitor|radiogroup|createPortal|overlay/);
  });
});
