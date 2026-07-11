import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// nav.tsx / session-controls.tsx are "use client" components and the suite runs
// in a node env (no DOM), so wiring is verified via source assertions — the same
// style used across the codebase for client components.
const NAV_SOURCE = readFileSync("src/components/nav.tsx", "utf8");
const SESSION_SOURCE = readFileSync("src/components/session-controls.tsx", "utf8");
const TOOLTIP_SOURCE = readFileSync("src/components/collapsed-sidebar-tooltip.tsx", "utf8");
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

describe("collapsed sidebar tooltips", () => {
  it("wraps every collapsed primary item with its exact label", () => {
    expect(NAV_SOURCE).toContain('<CollapsedSidebarTooltip key={item.href} label={item.label}>');
    expect(NAV_SOURCE).toContain('aria-label={collapsed ? item.label : undefined}');
    for (const label of ["Overview", "Finder", "Discover", "Imports", "Templates", "Sequences"]) {
      expect(operatorNavBlock()).toContain(`label: "${label}"`);
    }
  });

  it("adds collapsed labels for Account, Theme, and Log out", () => {
    expect(NAV_SOURCE).toContain('<CollapsedSidebarTooltip label="Account">');
    expect(NAV_SOURCE).toContain('aria-label={collapsed ? "Account" : undefined}');
    expect(SESSION_SOURCE).toContain('<CollapsedSidebarTooltip label="Theme">');
    expect(SESSION_SOURCE).toContain('<CollapsedSidebarTooltip label="Log out">');
    expect(SESSION_SOURCE).toContain('aria-label={collapsed ? "Log out" : undefined}');
  });

  it("only renders tooltip wrappers in the collapsed branches", () => {
    expect(NAV_SOURCE).toContain("return collapsed ? (");
    expect(NAV_SOURCE).toContain(": accountLink\n");
    expect(SESSION_SOURCE).toContain("{collapsed ? (");
  });

  it("supports mouse, keyboard, overflow-safe positioning, and non-blocking clicks", () => {
    expect(TOOLTIP_SOURCE).toContain("onPointerEnter={handlePointerEnter}");
    expect(TOOLTIP_SOURCE).toContain("onPointerLeave={() => setPosition(null)}");
    expect(TOOLTIP_SOURCE).toContain("onFocusCapture={showTooltip}");
    expect(TOOLTIP_SOURCE).toContain("onBlurCapture={handleBlur}");
    expect(TOOLTIP_SOURCE).toContain("onClickCapture={() => setPosition(null)}");
    expect(TOOLTIP_SOURCE).toContain('event.pointerType !== "touch"');
    expect(TOOLTIP_SOURCE).toContain("createPortal(");
    expect(GLOBALS).toMatch(/\.collapsed-sidebar-tooltip \{[\s\S]*?position:\s*fixed/);
    expect(GLOBALS).toMatch(/\.collapsed-sidebar-tooltip \{[\s\S]*?pointer-events:\s*none/);
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
    // The icon always renders; only the label span is hidden via CSS. aria-label
    // gives the collapsed rail an accessible name independent of its tooltip.
    expect(NAV_SOURCE).toContain('aria-label={collapsed ? "Account" : undefined}');
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
    const logoutIndex = SESSION_SOURCE.indexOf('<CollapsedSidebarTooltip label="Log out">');

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
