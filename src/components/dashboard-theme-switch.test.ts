import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardThemeSwitch } from "./dashboard-theme-switch";

const source = readFileSync("src/components/dashboard-theme-switch.tsx", "utf8");
const css = readFileSync("src/components/dashboard-theme-switch.module.css", "utf8");
const sessionControls = readFileSync("src/components/session-controls.tsx", "utf8");
const landingNav = readFileSync("src/components/landing-nav.tsx", "utf8");

describe("circular dashboard theme control", () => {
  it("reserves three circles when expanded and one circle when collapsed before hydration", () => {
    const expanded = renderToStaticMarkup(createElement(DashboardThemeSwitch, { collapsed: false }));
    const collapsed = renderToStaticMarkup(createElement(DashboardThemeSwitch, { collapsed: true }));
    expect(expanded.match(/<span/g)).toHaveLength(3);
    expect(collapsed.match(/<span/g)).toHaveLength(1);
    expect(expanded).toContain('aria-hidden="true"');
    expect(collapsed).toContain('aria-hidden="true"');
    expect(css).toContain("width: 48px");
    expect(css).toContain("height: 48px");
    expect(css).toContain("border-radius: 50%");
  });

  it("uses the supplied Framer Motion values for every icon entrance and exit", () => {
    expect(source).toContain("AnimatePresence");
    expect(source).toContain("motion.span");
    expect(source).toContain("rotate: -90, opacity: 0, scale: 0.5");
    expect(source).toContain("rotate: 0, opacity: 1, scale: 1");
    expect(source).toContain("rotate: 90, opacity: 0, scale: 0.5");
    expect(source).toContain("duration: 0.3");
    expect(source).toContain("key={`${value}-${animationSequence}`}");
    expect(source).toContain("[next]: current[next] + 1");
  });

  it("offers Light, System, and Dark directly with radio semantics", () => {
    expect(source).toContain('const themes = ["light", "system", "dark"]');
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('role="radio"');
    expect(source).toContain("aria-checked={theme === value}");
    expect(source).toContain("aria-label={`Use ${value} theme`}");
    expect(source).toContain("onClick={() => selectTheme(value)}");
    expect(source).toContain("window.localStorage.setItem(THEME_STORAGE_KEY, next)");
    expect(source).toContain("light: SunIcon");
    expect(source).toContain("system: MonitorIcon");
    expect(source).toContain("dark: MoonIcon");
  });

  it("keeps System selected from the preference even when the OS appearance differs", () => {
    for (const resolvedTheme of ["light", "dark"]) {
      expect(resolvedTheme).not.toBe("system");
      expect(source).toContain("selected={theme === value}");
    }
    expect(source).not.toContain("resolvedTheme");
  });

  it("uses a current-theme trigger and direct-choice popover only when collapsed", () => {
    expect(source).toContain("value={theme}");
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain("collapsed && open && popoverStyle ? createPortal(");
    expect(source).toContain("{renderOptions()}");
    expect(source).not.toMatch(/daliagents|fullscreen|overlay/);
    expect(sessionControls).toContain("DashboardThemeSwitch collapsed={collapsed}");
    expect(landingNav).toContain("ThemeSwitcher");
    expect(landingNav).not.toContain("DashboardThemeSwitch");
  });
});
