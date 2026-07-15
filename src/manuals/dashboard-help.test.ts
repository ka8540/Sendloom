import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { filterAvailableManualSteps } from "@/components/manual/manualSteps";
import type { ManualStep } from "@/components/manual/manualTypes";
import { getManualForPathname } from "@/manuals";
import { adminManual, adminSteps, resolveAdminSectionFromDom } from "@/manuals/adminManual";

const BUTTON_SOURCE = readFileSync("src/components/manual/ManualButton.tsx", "utf8");
const ADMIN_SOURCE = readFileSync("src/manuals/adminManual.ts", "utf8");

// Every authenticated dashboard route that should carry the shared premium Help
// button, with the route-specific label/tooltip it must show.
const DASHBOARD_ROUTES: Array<{ path: string; id: string; label: string; tooltip: string }> = [
  { path: "/workspace", id: "workspace", label: "Help with Overview", tooltip: "Overview guide" },
  { path: "/finder", id: "finder", label: "Help with Finder", tooltip: "Finder guide" },
  { path: "/imports", id: "imports", label: "Help with Imports", tooltip: "Imports guide" },
  { path: "/templates", id: "templates", label: "Help with Templates", tooltip: "Templates guide" },
  { path: "/campaigns", id: "campaigns", label: "Help with Sequences", tooltip: "Sequences guide" },
  {
    path: "/campaigns/new",
    id: "campaign-create",
    label: "Help with creating a sequence",
    tooltip: "Create sequence guide"
  },
  {
    path: "/sequences/new",
    id: "campaign-create",
    label: "Help with creating a sequence",
    tooltip: "Create sequence guide"
  },
  { path: "/campaigns/abc123", id: "campaign-detail", label: "Help with Sequences", tooltip: "Sequence guide" },
  { path: "/sequences/abc123", id: "campaign-detail", label: "Help with Sequences", tooltip: "Sequence guide" },
  { path: "/prospects", id: "discover-list", label: "Help with Discover", tooltip: "Discover guide" },
  { path: "/prospects/xyz", id: "discover-detail", label: "Help with Discover", tooltip: "Discover guide" },
  { path: "/admin", id: "admin", label: "Help with Admin", tooltip: "Admin guide" },
  { path: "/admin/users", id: "admin", label: "Help with Admin", tooltip: "Admin guide" },
  { path: "/admin/activity", id: "admin", label: "Help with Admin", tooltip: "Admin guide" },
  { path: "/admin/system-health", id: "admin", label: "Help with Admin", tooltip: "Admin guide" },
  { path: "/admin/restrictions", id: "admin", label: "Help with Admin", tooltip: "Admin guide" }
];

// Public / non-dashboard routes that must never receive the dashboard Help button.
const EXCLUDED_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/privacy",
  "/terms",
  "/abuse",
  "/faq",
  "/verify-eligibility",
  "/unsubscribe/token",
  "/suppressions",
  "/unknown"
];

function ids(steps: ManualStep[]): string[] {
  return steps.map((step) => step.id);
}

describe("Shared dashboard Help button reaches every authenticated route (#1, #2, #3, #4)", () => {
  it.each(DASHBOARD_ROUTES)("registers a labelled guide for $path", ({ path, id, label, tooltip }) => {
    const manual = getManualForPathname(path);
    expect(manual?.id).toBe(id);
    // Route-specific label + tooltip so the premium button reads correctly.
    expect(manual?.helpLabel).toBe(label);
    expect(manual?.helpTooltip).toBe(tooltip);
    // Premium button everywhere — never the "simple" fallback, never bare "Help".
    expect(manual?.helpVariant).not.toBe("simple");
  });

  it.each(EXCLUDED_ROUTES)("does not attach a dashboard guide to %s", (path) => {
    expect(getManualForPathname(path)).toBeNull();
  });

  it("uses one shared premium button component, not a per-page engine (#4, #5)", () => {
    expect(BUTTON_SOURCE).toContain("DashboardHelpButton");
    expect(BUTTON_SOURCE).toContain("overviewHelpRoot");
    // Clicking always opens the guide menu (never immediately starts a tour).
    expect(BUTTON_SOURCE).toMatch(/handleTrigger[\s\S]{0,200}setMenuOpen\(true\)/);
    expect(BUTTON_SOURCE).toContain("Quick start");
    expect(BUTTON_SOURCE).toContain("Full page tour");
  });

  it("opening help never triggers a backend mutation (#19)", () => {
    expect(BUTTON_SOURCE).not.toMatch(/fetch\(|graphql|prisma|useMutation|MUTATION/i);
    expect(ADMIN_SOURCE).not.toMatch(/fetch\(|graphql|prisma|useMutation|MUTATION/i);
  });
});

describe("Admin guide is route-adaptive and safely worded (#17, admin coverage)", () => {
  it("only normal-user routes resolve user guides; admin routes resolve the admin guide", () => {
    expect(getManualForPathname("/admin")).toBe(adminManual);
    expect(getManualForPathname("/admin/users")).toBe(adminManual);
    // A non-admin dashboard route never receives the admin configuration.
    expect(getManualForPathname("/workspace")?.id).toBe("workspace");
    expect(getManualForPathname("/templates")?.id).toBe("templates");
  });

  it("marks every admin step optional so absent sections are skipped (#17)", () => {
    for (const step of adminSteps) {
      expect(step.optional).toBe(true);
      expect(step.selector).toBeTruthy();
    }
  });

  it("filters the steps down to the section actually on screen", () => {
    // Simulate the /admin/users route: only the users section is present.
    const present = new Set(['[data-admin-tour="users"]', '[aria-label="Next user page"]']);
    const shown = ids(filterAvailableManualSteps(adminSteps, (selector) => present.has(selector)));
    expect(shown).toContain("users");
    expect(shown).toContain("users-pagination");
    expect(shown).not.toContain("system-health");
    expect(shown).not.toContain("activity");
    expect(shown).not.toContain("overview");
  });

  it("resolves the current admin section from the DOM marker for quick steps", () => {
    expect(typeof resolveAdminSectionFromDom).toBe("function");
    // Quick start picks the visible section's first steps; Full page tour shows all.
    expect(ADMIN_SOURCE).toContain("resolveAdminSectionFromDom()");
    expect(ADMIN_SOURCE).toMatch(/quickStartStage:\s*"quick"/);
    expect(ADMIN_SOURCE).toMatch(/fullTourStage:\s*"full"/);
  });

  it("never exposes credentials, tokens, secrets, or stack traces", () => {
    const text = adminSteps.map((step) => `${step.title} ${step.body}`).join(" ");
    expect(text).not.toMatch(/password|token|secret|api[_ ]?key|connection string|stack trace|env(ironment)? var/i);
  });
});
