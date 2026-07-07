import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// nav.tsx is a "use client" component and the suite runs in a node env (no DOM),
// so its wiring is verified via source assertions — the same style used across
// the codebase for client components.
const NAV_SOURCE = readFileSync("src/components/nav.tsx", "utf8");

function operatorNavBlock(): string {
  // The non-admin items array is the branch after the `isAdmin ?` ternary.
  const start = NAV_SOURCE.indexOf("] : [");
  const marker = NAV_SOURCE.indexOf(": [", NAV_SOURCE.indexOf("isAdmin"));
  const from = start === -1 ? marker : start;
  return NAV_SOURCE.slice(from, NAV_SOURCE.indexOf("];", from));
}

describe("app sidebar navigation", () => {
  it("adds an Account tab to the authenticated (non-admin) sidebar", () => {
    const block = operatorNavBlock();
    expect(block).toContain('href: "/account" as Route');
    expect(block).toContain('label: "Account"');
    expect(block).toContain("icon: CircleUserRound");
  });

  it("imports the Account icon from lucide", () => {
    expect(NAV_SOURCE).toContain("CircleUserRound");
    expect(NAV_SOURCE).toMatch(/import \{[\s\S]*CircleUserRound[\s\S]*\} from "lucide-react";/);
  });

  it("keeps every existing operator nav item alongside Account", () => {
    const block = operatorNavBlock();
    for (const label of ["Overview", "Finder", "Discover", "Imports", "Templates", "Sequences", "Account"]) {
      expect(block).toContain(`label: "${label}"`);
    }
  });

  it("does not add Account to the admin sidebar", () => {
    // The admin branch is the array between `? [` and the else `: [`.
    const adminBranch = NAV_SOURCE.slice(NAV_SOURCE.indexOf("? ["), NAV_SOURCE.indexOf(": ["));
    expect(adminBranch).toContain('label: "Users"');
    expect(adminBranch).not.toContain('label: "Account"');
  });

  it("computes an active state that matches /account (shared exact/prefix logic)", () => {
    // The generic active check covers /account without a special case.
    expect(NAV_SOURCE).toContain("pathname === item.href");
    expect(NAV_SOURCE).toContain('pathname.startsWith(`${item.href}/`)');
    expect(NAV_SOURCE).toContain('className={`nav-item${active ? " is-active" : ""}`}');
    expect(NAV_SOURCE).toContain('aria-current={active ? "page" : undefined}');
  });

  it("still renders the logout controls at the bottom", () => {
    expect(NAV_SOURCE).toContain("<SessionControls");
  });
});
