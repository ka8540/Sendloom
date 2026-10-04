import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeSwitch, switchChecked, themeFromSwitch } from "./theme-switch";

describe("dashboard theme switch", () => {
  it("shows the resolved appearance in System while keeping System as the preference", () => {
    expect(switchChecked("system", false)).toBe(false);
    expect(switchChecked("system", true)).toBe(true);
    expect(switchChecked("light", true)).toBe(false);
    expect(switchChecked("dark", false)).toBe(true);
  });

  it("lets either side override System directly", () => {
    expect(themeFromSwitch("system", true, "light")).toBe("light");
    expect(themeFromSwitch("system", false, "dark")).toBe("dark");
    expect(themeFromSwitch("system", true, null)).toBe("dark");
    expect(themeFromSwitch("system", false, null)).toBe("light");
  });

  it("renders a same-size shell without claiming a theme during server rendering", () => {
    const html = renderToStaticMarkup(createElement(ThemeSwitch));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("keeps the public navbar on its original theme menu", () => {
    const publicNav = readFileSync("src/components/landing-nav.tsx", "utf8");
    const sidebarFooter = readFileSync("src/components/session-controls.tsx", "utf8");
    expect(publicNav).toContain('<ThemeSwitcher className={styles.desktopThemeMenu} />');
    expect(publicNav).not.toContain("ThemeSwitch />");
    expect(sidebarFooter).toContain("collapsed ? <ThemeSwitcher");
    expect(sidebarFooter).toContain(": <ThemeSwitch />");
  });
});
