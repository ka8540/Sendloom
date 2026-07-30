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
  it("is a subtle 1px line using the shared border token, with breathing room", () => {
    const start = GLOBALS.indexOf(".nav-footer-divider {");
    const block = GLOBALS.slice(start, GLOBALS.indexOf("}", start));
    expect(block).toMatch(/height:\s*1px/);
    // The minimal dashboard system owns the sidebar's hairline token.
    expect(block).toContain("var(--ui-border)");
    expect(block).toMatch(/margin:/);
  });

  it("shortens the divider on the collapsed rail", () => {
    expect(GLOBALS).toMatch(
      /\.sidebar\.is-collapsed \.nav-footer-divider[\s\S]*?width:\s*1\.75rem/
    );
  });
});
