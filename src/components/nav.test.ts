import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// nav.tsx / session-controls.tsx are "use client" components and the suite runs
// in a node env (no DOM), so wiring is verified via source assertions — the same
// style used across the codebase for client components.
const NAV_SOURCE = readFileSync("src/components/nav.tsx", "utf8");
const SESSION_SOURCE = readFileSync("src/components/session-controls.tsx", "utf8");
const ANALYSIS_WORKSPACE_SOURCE = readFileSync("src/components/analysis/analysis-workspace.tsx", "utf8");
const APP_LAYOUT_SOURCE = readFileSync("src/app/(app)/layout.tsx", "utf8");
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

describe("expanded Analysis navigation", () => {
  it("renames only the Analysis overview label to Summary", () => {
    expect(operatorNavBlock()).toContain('{ href: "/workspace" as Route, label: "Overview"');
    expect(NAV_SOURCE).toContain('{ href: "/analysis" as Route, label: "Summary" }');
    expect(ANALYSIS_WORKSPACE_SOURCE).toContain('overview: { label: "Summary"');
    expect(ANALYSIS_WORKSPACE_SOURCE).toContain('href: "/analysis" as Route');
  });

  it("uses an accessible button and chevron only for the expanded Analysis parent", () => {
    expect(NAV_SOURCE).toContain("if (isAnalysis && !collapsed)");
    expect(NAV_SOURCE).toContain('className={`nav-item nav-analysis-toggle${active ? " is-active" : ""}`}');
    expect(NAV_SOURCE).toContain("aria-expanded={analysisOpen}");
    expect(NAV_SOURCE).toContain("aria-controls={ANALYSIS_NAVIGATION_ID}");
    expect(NAV_SOURCE).toContain('aria-label={`${analysisOpen ? "Collapse" : "Expand"} Analysis navigation`}');
    expect(NAV_SOURCE).toContain("<ChevronDown");
    expect(NAV_SOURCE).toContain("hidden={!analysisOpen}");
  });

  it("opens automatically on Analysis routes and closes by default elsewhere", () => {
    expect(NAV_SOURCE).toContain('pathname === "/analysis" || pathname.startsWith("/analysis/")');
    expect(NAV_SOURCE).toContain("useState(analysisRouteActive)");
    expect(NAV_SOURCE).toContain("previousPathnameRef.current === pathname");
    expect(NAV_SOURCE).toContain("setAnalysisOpen(analysisRouteActive)");
    expect(NAV_SOURCE).toContain("onClick={() => setAnalysisOpen((current) => !current)}");
  });

  it("preserves the collapsed Analysis link and tooltip behavior", () => {
    expect(NAV_SOURCE).toContain('title={collapsed ? item.label : undefined}');
    expect(NAV_SOURCE).toContain('href={item.href}');
    expect(GLOBALS).toMatch(/\.sidebar\.is-collapsed \.nav-submenu,[\s\S]*?display:\s*none/);
  });
});

describe("expanded sidebar height structure", () => {
  it("uses a viewport-bound flex column without making the whole expanded sidebar scroll", () => {
    expect(GLOBALS).toMatch(/\.sidebar:not\(\.is-collapsed\) \{[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/);
    expect(GLOBALS).toMatch(/\.sidebar:not\(\.is-collapsed\) \.sidebar-top \{[\s\S]*?display:\s*flex;[\s\S]*?flex-shrink:\s*0;/);
    expect(GLOBALS).toMatch(/\.sidebar:not\(\.is-collapsed\) \.nav-footer \{[\s\S]*?flex-shrink:\s*0;/);
  });

  it("limits short-height overflow to the middle navigation and hides its scrollbar", () => {
    expect(GLOBALS).toMatch(/\.sidebar:not\(\.is-collapsed\) \.nav \{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/);
    expect(GLOBALS).toContain("scrollbar-width: none");
    expect(GLOBALS).toMatch(/\.sidebar:not\(\.is-collapsed\) \.nav::\-webkit-scrollbar \{[\s\S]*?display:\s*none/);
  });

  it("groups the expanded brand and collapse control in one compact row", () => {
    expect(GLOBALS).toMatch(/\.sidebar:not\(\.is-collapsed\) \.sidebar-top \{[\s\S]*?align-items:\s*flex-start;[\s\S]*?justify-content:\s*space-between/);
    expect(GLOBALS).toMatch(/\.sidebar:not\(\.is-collapsed\) \.brand \{[\s\S]*?flex:\s*1 1 auto/);
  });

  it("gives only the expanded brand header balanced top and bottom breathing room", () => {
    expect(GLOBALS).toMatch(/\.sidebar:not\(\.is-collapsed\) \{[\s\S]*?padding:\s*1\.5rem 1rem 0\.75rem/);
    expect(GLOBALS).toMatch(/\.sidebar:not\(\.is-collapsed\) \.sidebar-top \{[\s\S]*?padding-bottom:\s*1\.1rem/);
  });
});

describe("expanded Analysis visual consistency", () => {
  function cssBlock(selector: string): string {
    const start = GLOBALS.indexOf(`${selector} {`);
    return GLOBALS.slice(start, GLOBALS.indexOf("}", start));
  }

  it("uses the shared primary navigation typography without an Analysis-specific font reset", () => {
    const primaryItemBlock = cssBlock(".nav-item");
    const analysisToggleBlock = cssBlock(".nav-analysis-toggle");

    expect(primaryItemBlock).toContain("font-family: inherit");
    expect(primaryItemBlock).toContain("font-size: inherit");
    expect(primaryItemBlock).toContain("line-height: inherit");
    expect(primaryItemBlock).toContain("letter-spacing: inherit");
    expect(primaryItemBlock).toContain("font-weight: 600");
    expect(analysisToggleBlock).not.toContain("font:");
  });

  it("keeps the Analysis submenu compact and readable", () => {
    expect(cssBlock(".nav-submenu")).toContain("gap: 0.25rem");
    expect(cssBlock(".nav-submenu")).toContain("padding: 0.25rem 0.25rem 0.2rem 2.55rem");
    expect(cssBlock(".nav-submenu-item")).toContain("min-height: 1.625rem");
  });

  it("gives expanded primary rows and Analysis children extra vertical breathing room", () => {
    // Expanded-desktop-only overrides; collapsed and compact layouts keep the
    // global dimensions asserted above.
    expect(GLOBALS).toMatch(/\.sidebar:not\(\.is-collapsed\) \.nav \{[\s\S]*?gap:\s*0\.55rem/);
    expect(GLOBALS).toMatch(
      /\.sidebar:not\(\.is-collapsed\) \.nav > \.nav-item \{[\s\S]*?min-height:\s*3\.25rem;[\s\S]*?padding:\s*0\.8rem 0\.85rem/
    );
    expect(GLOBALS).toMatch(
      /\.sidebar:not\(\.is-collapsed\) \.nav-submenu \{[\s\S]*?gap:\s*0\.35rem;[\s\S]*?padding:\s*0\.7rem 0\.25rem 0\.6rem 2\.55rem/
    );
    expect(GLOBALS).toMatch(
      /\.sidebar:not\(\.is-collapsed\) \.nav-submenu-item \{[\s\S]*?min-height:\s*2\.625rem;[\s\S]*?padding:\s*0\.55rem 0\.5rem/
    );
  });
});

describe("selected navigation styling", () => {
  function cssBlock(selector: string): string {
    const start = GLOBALS.indexOf(`${selector} {`);
    return GLOBALS.slice(start, GLOBALS.indexOf("}", start));
  }

  it("uses a transparent row with green icon and label when selected", () => {
    const activeBlock = cssBlock(".nav-item.is-active");

    expect(activeBlock).toContain("position: relative");
    expect(activeBlock).toContain("background: transparent");
    expect(activeBlock).toContain("color: var(--accent)");
    expect(activeBlock).not.toContain("box-shadow");
    expect(activeBlock).not.toContain("gradient");
    expect(activeBlock).not.toContain("border-radius");
    expect(activeBlock).not.toContain("var(--accent-soft)");
  });

  it("keeps unselected navigation content dark", () => {
    expect(cssBlock(".nav-item")).toContain("color: var(--text)");
  });

  it("renders exactly one slim left accent bar inside the active row", () => {
    const barBlock = cssBlock(".nav-item.is-active::before");

    expect(barBlock).toContain('content: ""');
    expect(barBlock).toContain("position: absolute");
    expect(barBlock).toContain("left: 0");
    expect(barBlock).toContain("top: 50%");
    expect(barBlock).toContain("width: 3px");
    expect(barBlock).toContain("height: 30px");
    expect(barBlock).toContain("border-radius: 999px");
    expect(barBlock).toContain("background: var(--accent)");
    expect(barBlock).toContain("transform: translateY(-50%)");
    expect(GLOBALS).not.toContain(".nav-item.is-active::after");
  });

  it("avoids an icon tile, gradient, and movement", () => {
    expect(GLOBALS).not.toContain(".nav-item.is-active svg");
    expect(GLOBALS).not.toContain("--nav-active-background");
    expect(GLOBALS).not.toContain("--nav-active-shadow");
    expect(cssBlock(".nav-item")).not.toContain("transform");
  });

  it("keeps the active row transparent on hover and focus (no bespoke fill tokens)", () => {
    expect(GLOBALS).toMatch(
      /\.nav-item\.is-active:hover,\n\.nav-item\.is-active:focus-visible \{[\s\S]*?background: transparent;[\s\S]*?color: var\(--accent-strong\);[\s\S]*?\}/
    );
    expect(GLOBALS).not.toContain("--sidebar-nav-active-");
  });

  it("keeps inactive hover restrained and shadow-free", () => {
    const hoverBlock = cssBlock(".nav-item:hover");

    expect(cssBlock(".nav-item")).toContain("border-radius: 12px");
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

  it("shows the user's profile photo in place of the Account icon when one exists", () => {
    expect(NAV_SOURCE).toContain("profilePhotoUrl?: string | null");
    expect(NAV_SOURCE).toContain('className="nav-avatar"');
    expect(NAV_SOURCE).toContain('src={profilePhotoUrl ?? ""}');
    // Decorative inside a labelled link — no redundant alt text.
    expect(NAV_SOURCE).toContain('alt=""');
    // The generic icon remains the fallback for no-photo and load-failure.
    expect(NAV_SOURCE).toContain("avatarFailed");
    expect(NAV_SOURCE).toContain("onError={() => setAvatarFailed(true)}");
    expect(NAV_SOURCE).toContain("<CircleUserRound aria-hidden=\"true\" />");
  });

  it("keeps the nav avatar circular, cover-cropped, and icon-sized in both rails", () => {
    const start = GLOBALS.indexOf(".nav-avatar {");
    expect(start).toBeGreaterThan(-1);
    const block = GLOBALS.slice(start, GLOBALS.indexOf("}", start));
    expect(block).toContain("border-radius: 999px");
    expect(block).toContain("object-fit: cover");
    expect(block).toContain("width: 1.75rem");
    expect(block).toContain("height: 1.75rem");
  });

  it("receives the safe app-local photo URL from the app layout (never the raw key)", () => {
    expect(APP_LAYOUT_SOURCE).toContain("user.profilePhotoKey && user.profilePhotoUpdatedAt");
    expect(APP_LAYOUT_SOURCE).toContain("buildProfilePhotoImageUrl(user.profilePhotoUpdatedAt)");
    expect(APP_LAYOUT_SOURCE).toContain("profilePhotoUrl={profilePhotoUrl}");
    // The notification center wiring from the base branch stays in place.
    expect(APP_LAYOUT_SOURCE).toContain("<NotificationCenter />");
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
