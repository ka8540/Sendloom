import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardThemeSwitch, nextTheme } from "./dashboard-theme-switch";

const source = readFileSync("src/components/dashboard-theme-switch.tsx", "utf8");
const css = readFileSync("src/components/dashboard-theme-switch.module.css", "utf8");
const sessionControls = readFileSync("src/components/session-controls.tsx", "utf8");
const landingNav = readFileSync("src/components/landing-nav.tsx", "utf8");

describe("single circular dashboard theme button", () => {
  it("cycles Light → Dark → System → Light and repeats", () => {
    expect(nextTheme).toEqual({ light: "dark", dark: "system", system: "light" });
    let current: keyof typeof nextTheme = "light";
    const visited: string[] = [];
    for (let click = 0; click < 6; click += 1) {
      current = nextTheme[current];
      visited.push(current);
    }
    expect(visited).toEqual(["dark", "system", "light", "dark", "system", "light"]);
  });

  it("maps one icon to each saved preference rather than the OS appearance", () => {
    expect(source).toContain("light: SunIcon");
    expect(source).toContain("dark: MoonIcon");
    expect(source).toContain("system: MonitorIcon");
    expect(source).toContain("const Icon = icons[theme]");
    expect(source).toContain("key={theme}");
    expect(source).not.toContain("resolvedTheme");
  });

  it("uses the exact incoming and outgoing Framer Motion values", () => {
    expect(source).toContain('AnimatePresence mode="wait" initial={false}');
    expect(source).toContain("rotate: -90, opacity: 0, scale: 0.5");
    expect(source).toContain("rotate: 0, opacity: 1, scale: 1");
    expect(source).toContain("rotate: 90, opacity: 0, scale: 0.5");
    expect(source).toContain("duration: 0.3");
  });

  it("renders one 36px noninteractive placeholder before hydration", () => {
    const markup = renderToStaticMarkup(createElement(DashboardThemeSwitch));
    expect(markup.match(/<span/g)).toHaveLength(1);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("<button");
    expect(css).toContain("width: 36px");
    expect(css).toContain("height: 36px");
    expect(source).toContain("<Icon size={18}");
  });

  it("has one dashboard button, no popover, and leaves the public navbar alone", () => {
    expect(source.match(/<button /g)).toHaveLength(1);
    expect(source).toContain("onClick={handleClick}");
    expect(source).toContain("nextTheme[theme]");
    expect(source).toContain("aria-label={label} title={label}");
    expect(source).not.toMatch(/createPortal|popover|radiogroup|role="radio"|fullscreen|overlay/);
    expect(sessionControls).toContain("<DashboardThemeSwitch />");
    expect(landingNav).toContain("ThemeSwitcher");
    expect(landingNav).not.toContain("DashboardThemeSwitch");
  });
});
