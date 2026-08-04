import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// nav.tsx / session-controls.tsx are "use client" components and the suite runs
// in a node env (no DOM), so wiring is verified via source assertions — the same
// style used across the codebase for client components.
const NAV_SOURCE = readFileSync("src/components/nav.tsx", "utf8");
const SESSION_SOURCE = readFileSync("src/components/session-controls.tsx", "utf8");
const GLOBALS = readFileSync("src/app/globals.css", "utf8");

function operatorNavBlock(): string {
  // The non-admin primary items array is the ternary's else branch: `: [ … ];`.
  const start = NAV_SOURCE.indexOf(": [", NAV_SOURCE.indexOf("isAdmin"));
  return NAV_SOURCE.slice(start, NAV_SOURCE.indexOf("];", start));
}

describe("primary product navigation", () => {
  it("still renders every main dashboard item", () => {
    const block = operatorNavBlock();
    for (const label of ["Overview", "Finder", "Discover", "Imports", "Templates", "Sequences"]) {
      expect(block).toContain(`label: "${label}"`);
    }
  });

  it("no longer groups Account with the primary dashboard nav", () => {
    // Account is intentionally out of the primary items array.
    expect(operatorNavBlock()).not.toContain('label: "Account"');
  });

  it("keeps the shared active-state logic for primary items", () => {
    expect(NAV_SOURCE).toContain("pathname === item.href");
    expect(NAV_SOURCE).toContain('pathname.startsWith(`${item.href}/`)');
    expect(NAV_SOURCE).toContain('className={`nav-item${active ? " is-active" : ""}`}');
  });
});

describe("selected navigation styling", () => {
  function cssBlock(selector: string): string {
    const start = GLOBALS.indexOf(`${selector} {`);
    return GLOBALS.slice(start, GLOBALS.indexOf("}", start));
  }

  it("uses a softly asymmetric solid green tab with white icon and text", () => {
    const activeBlock = cssBlock(".nav-item.is-active");

    expect(activeBlock).toContain("border-radius: 14px 18px 18px 14px");
    expect(activeBlock).toContain("background: var(--sidebar-nav-active-bg)");
    expect(activeBlock).toContain("color: #ffffff");
    expect(activeBlock).toContain("box-shadow: var(--sidebar-nav-active-shadow)");
    expect(activeBlock).not.toContain("gradient");
    expect(activeBlock).not.toContain("var(--accent-soft)");
  });

  it("keeps unselected navigation content dark", () => {
    expect(cssBlock(".nav-item")).toContain("color: var(--text)");
  });

  it("has no side bars or detached indicators on the active tab", () => {
    expect(GLOBALS).not.toContain(".nav-item.is-active::before");
    expect(GLOBALS).not.toContain(".nav-item.is-active::after");
    expect(GLOBALS).not.toContain("--sidebar-nav-active-side-cap");
  });

  it("forces the active icon white and avoids gradients or movement", () => {
    expect(cssBlock(".nav-item.is-active svg")).toContain("color: #ffffff");
    expect(GLOBALS).not.toContain("--nav-active-background");
    expect(GLOBALS).not.toContain("--nav-active-shadow");
    expect(cssBlock(".nav-item")).not.toContain("transform");
  });

  it("defines solid active colors for light, dark, and system-dark themes", () => {
    expect(GLOBALS.match(/--sidebar-nav-active-bg:/g)).toHaveLength(3);
    expect(GLOBALS).toContain("--sidebar-nav-active-bg: var(--accent)");
    expect(GLOBALS).toContain("--sidebar-nav-active-bg: color-mix(in srgb, var(--accent) 55%, #06281b)");
  });

  it("keeps inactive hover restrained and shadow-free", () => {
    const hoverBlock = cssBlock(".nav-item:hover");

    expect(cssBlock(".nav-item")).toContain("border-radius: 14px");
    expect(hoverBlock).toContain("background: var(--surface-hover)");
    expect(hoverBlock).not.toContain("box-shadow");
    expect(hoverBlock).not.toContain("transform");
  });

  it("keeps a visible focus ring that does not rely on background color", () => {
    const focusBlock = cssBlock(".nav-item:focus-visible");

    expect(focusBlock).toContain("outline: 2px solid");
    expect(focusBlock).toContain("outline-offset: 2px");
  });

  it("preserves the existing collapsed navigation dimensions", () => {
    expect(GLOBALS).toMatch(/\.sidebar\.is-collapsed \.nav-item,[\s\S]*?width:\s*3\.35rem/);
    expect(GLOBALS).toMatch(/\.sidebar\.is-collapsed \.nav-item,[\s\S]*?height:\s*3\.35rem/);
  });
});

describe("Account moved to the lower account/utility section", () => {
  it("renders Account as a nav item passed into the footer utility slot (not admin)", () => {
    expect(NAV_SOURCE).toContain('const accountHref = "/account" as Route;');
    expect(NAV_SOURCE).toContain("const utilityNav = isAdmin ? null : (");
    expect(NAV_SOURCE).toContain("<CircleUserRound aria-hidden=\"true\" />");
    expect(NAV_SOURCE).toContain("<span>Account</span>");
    expect(NAV_SOURCE).toContain("utilityNav={utilityNav}");
  });

  it("computes the Account active state for /account (same rule as primary items)", () => {
    expect(NAV_SOURCE).toContain(
      "const accountActive = pathname === accountHref || pathname.startsWith(`${accountHref}/`);"
    );
    expect(NAV_SOURCE).toContain('className={`nav-item${accountActive ? " is-active" : ""}`}');
    expect(NAV_SOURCE).toContain('aria-current={accountActive ? "page" : undefined}');
  });

  it("keeps the Account icon visible when the sidebar is collapsed", () => {
    // The icon always renders; only the label span is hidden via CSS. The title
    // gives the collapsed rail an accessible tooltip.
    expect(NAV_SOURCE).toContain('title={collapsed ? "Account" : undefined}');
  });

  it("does not expose Account in the admin sidebar", () => {
    // utilityNav is null for admins, and Account is absent from the admin items.
    const adminBranch = NAV_SOURCE.slice(NAV_SOURCE.indexOf("? ["), NAV_SOURCE.indexOf(": ["));
    expect(adminBranch).not.toContain('label: "Account"');
    expect(NAV_SOURCE).toContain("isAdmin ? null :");
  });
});

describe("session controls footer order", () => {
  it("renders the theme control, then a divider, then Account, then logout", () => {
    const themeIndex = SESSION_SOURCE.indexOf("nav-footer-theme");
    const dividerIndex = SESSION_SOURCE.indexOf("nav-footer-divider");
    const utilityIndex = SESSION_SOURCE.indexOf("{utilityNav}");
    // Anchor on the rendered label — the performLogout callback is defined
    // above the JSX and would match before the utility slot.
    const logoutIndex = SESSION_SOURCE.indexOf('"Log out"');

    expect(themeIndex).toBeGreaterThan(-1);
    expect(dividerIndex).toBeGreaterThan(themeIndex);
    expect(utilityIndex).toBeGreaterThan(dividerIndex);
    expect(logoutIndex).toBeGreaterThan(utilityIndex);
  });

  it("only shows the divider when there is a utility item (no dangling separator for admins)", () => {
    expect(SESSION_SOURCE).toContain("utilityNav ? (");
    expect(SESSION_SOURCE).toContain('<div className="nav-footer-divider" role="separator" aria-hidden="true" />');
  });

  it("keeps the theme switcher and logout controls intact", () => {
    expect(SESSION_SOURCE).toContain("ThemeSwitcher");
    expect(SESSION_SOURCE).toContain('className="nav-item nav-item-button"');
    expect(SESSION_SOURCE).toContain("Log out");
  });
});

describe("divider styling matches the dark UI", () => {
  it("is a subtle 1px line using the shared line token, with breathing room", () => {
    const start = GLOBALS.indexOf(".nav-footer-divider {");
    const block = GLOBALS.slice(start, GLOBALS.indexOf("}", start));
    expect(block).toMatch(/height:\s*1px/);
    expect(block).toContain("var(--line)");
    expect(block).toMatch(/margin:/);
  });

  it("shortens the divider on the collapsed rail", () => {
    expect(GLOBALS).toMatch(
      /\.sidebar\.is-collapsed \.nav-footer-divider[\s\S]*?width:\s*1\.75rem/
    );
  });
});
