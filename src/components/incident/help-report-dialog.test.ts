import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { appErrorCategory } from "@/lib/incident/app-error";
import { createReportSchema } from "@/lib/incident/report-input";
import { deriveSeverity } from "@/lib/incident/severity";
import { HELP_REPORT_ISSUE_TYPES } from "@/components/incident/help-report-dialog";
import { getManualForPathname } from "@/manuals";

// This repo runs vitest in a `node` environment with no DOM renderer, so the
// dialog + menu behavior is verified through pure logic (the shared incident
// category/severity/schema) plus static source assertions — the same convention
// used by recovery-source-audit.test.ts and dashboard-help.test.ts.
const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), "utf8");

const BUTTON = read("src/components/manual/ManualButton.tsx");
const DIALOG = read("src/components/incident/help-report-dialog.tsx");
const DIALOG_CSS = read("src/components/incident/help-report-dialog.module.css");

// Every authenticated dashboard whose shared help menu must now carry Report
// issue (all use the premium menu button — none the "simple" fallback).
const DASHBOARD_ROUTES = [
  { path: "/workspace", label: "Overview" },
  { path: "/prospects", label: "Discover" },
  { path: "/prospects/xyz", label: "Discover" },
  { path: "/finder", label: "Finder" },
  { path: "/imports", label: "Imports" },
  { path: "/templates", label: "Templates" },
  { path: "/campaigns", label: "Sequences" },
  { path: "/campaigns/abc123", label: "Sequence detail" },
  { path: "/admin", label: "Admin" },
  { path: "/admin/users", label: "Admin" },
  { path: "/admin/restrictions", label: "Admin" },
  { path: "/admin/system-health", label: "Admin" },
  { path: "/admin/activity", label: "Admin" }
];

describe("Help menu retains Quick start + Full page tour (#1, #2, #12, #13)", () => {
  it("still renders the Quick start action wired to the quick-start stage", () => {
    expect(BUTTON).toContain("Quick start");
    expect(BUTTON).toContain("startStage(quickStartStage)");
  });

  it("still renders the Full page tour action wired to the full-tour stage", () => {
    expect(BUTTON).toContain("Full page tour");
    expect(BUTTON).toContain("startStage(fullTourStage)");
  });
});

describe("Help menu renders a Report issue action (#3, #4)", () => {
  it("adds a Report issue menu item with its subtitle", () => {
    expect(BUTTON).toContain("Report issue");
    expect(BUTTON).toContain("Tell us what went wrong on this page");
  });

  it("is visually separated from the guide/tour actions by a divider", () => {
    expect(BUTTON).toContain("overviewMenuDivider");
  });

  it("clicking Report issue opens the dialog (openReport -> setReportOpen)", () => {
    expect(BUTTON).toContain("onClick={openReport}");
    expect(BUTTON).toContain("setReportOpen(true)");
    expect(BUTTON).toContain("<HelpReportDialog");
  });
});

describe("Report modal contents (#5, #6, #7)", () => {
  it("shows an issue type dropdown with the expected options", () => {
    expect(DIALOG).toContain("<select");
    const values = HELP_REPORT_ISSUE_TYPES.map((type) => type.value);
    expect(values).toEqual(["Bug", "Confusing UI", "Wrong data", "Loading/performance", "Guide/tour issue", "Other"]);
  });

  it("shows a description textarea with the prompt placeholder", () => {
    expect(DIALOG).toContain("<textarea");
    expect(DIALOG).toContain("What happened? What were you trying to do?");
  });

  it("shows read-only page context (page label, route/location, time)", () => {
    expect(DIALOG).toContain("Report context");
    expect(DIALOG).toContain("{pageLabel}");
    expect(DIALOG).toContain("window.location.pathname");
    expect(DIALOG).toContain("openedAtLabel");
  });
});

describe("Submit gating + payload (#8, #9)", () => {
  it("disables Send while the description is empty", () => {
    expect(DIALOG).toContain("const noteReady = note.trim().length > 0");
    expect(DIALOG).toContain("disabled={submitting || !online || !noteReady}");
  });

  it("sends issue type, description, route, and guide/page context to /api/incidents", () => {
    expect(DIALOG).toContain('"/api/incidents"');
    for (const key of [
      "category:",
      "feature: pageLabel",
      "operation: issueType",
      "route:",
      "currentOperationState: guideContext",
      "userNote: note.trim()",
      "idempotencyKey:"
    ]) {
      expect(DIALOG).toContain(key);
    }
  });

  it("tags the report with the manual category so admins can filter manual feedback", () => {
    expect(DIALOG).toContain('"USER_REPORTED_ISSUE"');
    // The category must round-trip through the server mapper (never fall back to UNKNOWN).
    expect(appErrorCategory("USER_REPORTED_ISSUE")).toBe("USER_REPORTED_ISSUE");
  });

  it("passes the manual page label + a stable guide context from every dashboard", () => {
    expect(BUTTON).toContain("pageLabel={manual.routeLabel}");
    expect(BUTTON).toContain("guideContext={guideContextForManual(manual)}");
    expect(BUTTON).toContain("overview_guide_menu");
    expect(BUTTON).toContain("discover_guide_menu");
    expect(BUTTON).toContain("admin_guide_menu");
  });
});

describe("Submit outcomes (#10, #11)", () => {
  it("shows the success copy and only a Done action after a successful submit", () => {
    expect(DIALOG).toContain("Thanks — your report was sent.");
    expect(DIALOG).toContain('state.kind === "success"');
  });

  it("keeps the form open with a safe error on failure (never a raw backend message)", () => {
    expect(DIALOG).toContain("We couldn&apos;t send the report. Please try again.");
    // The error state is not treated as resolved, so Cancel/Send stay rendered.
    expect(DIALOG).toContain('const isResolved = state.kind === "success" || state.kind === "recorded"');
  });
});

describe("Every dashboard help menu includes Report issue (#14-20)", () => {
  it.each(DASHBOARD_ROUTES)("$path resolves to a premium menu that carries Report issue", ({ path: routePath, label }) => {
    const manual = getManualForPathname(routePath);
    expect(manual).not.toBeNull();
    // Premium menu = the shared button that now renders the Report issue item.
    expect(manual?.helpVariant).not.toBe("simple");
    expect(manual?.routeLabel).toBe(label);
  });

  it("the report item lives in the single shared menu button, so no route is missed", () => {
    expect(BUTTON).toContain('data-tour-report-issue="true"');
  });
});

describe("Privacy: manual report payload carries only safe fields (#21)", () => {
  // The exact keys the dialog puts in the request body.
  const safePayload = {
    category: "USER_REPORTED_ISSUE",
    feature: "Discover",
    operation: "Bug",
    route: "/prospects",
    currentOperationState: "discover_guide_menu",
    onlineStatus: true,
    browserFamily: "Chrome",
    platform: "macOS",
    userNote: "The status column looked wrong.",
    idempotencyKey: "idem-123"
  };

  it("is accepted as-is by the strict server schema", () => {
    expect(createReportSchema.safeParse(safePayload).success).toBe(true);
  });

  it("rejects any attempt to smuggle sensitive fields (strict schema)", () => {
    for (const sensitive of ["cookie", "authorization", "accessToken", "localStorage", "html", "contacts", "email"]) {
      const result = createReportSchema.safeParse({ ...safePayload, [sensitive]: "x" });
      expect(result.success).toBe(false);
    }
  });

  it("the dialog never reads storage, cookies-as-data, or DOM/screenshot content", () => {
    expect(DIALOG).not.toMatch(/localStorage|sessionStorage/);
    expect(DIALOG).not.toMatch(/innerHTML|outerHTML|documentElement\.innerHTML/);
    expect(DIALOG).not.toMatch(/canvas|screenshot|toDataURL/);
    // The only cookie access is the shared CSRF helper, sent as a header (not body).
    expect(DIALOG).toContain("readCsrfToken");
    expect(DIALOG).toContain("x-csrf-token");
  });

  it("manual reports default to a low severity (not treated as an outage)", () => {
    expect(deriveSeverity("USER_REPORTED_ISSUE", 1)).toBe("LOW");
  });
});

describe("Accessibility + no native dialogs (#22)", () => {
  it("the dialog is a labelled modal with focus + Escape handling", () => {
    expect(DIALOG).toContain('role="dialog"');
    expect(DIALOG).toContain('aria-modal="true"');
    expect(DIALOG).toContain("aria-labelledby={titleId}");
    expect(DIALOG).toContain("aria-describedby={descId}");
    expect(DIALOG).toContain('event.key === "Escape"');
    expect(DIALOG).toContain("selectRef.current?.focus()");
  });

  it("associates labels with the type + description inputs and announces errors", () => {
    expect(DIALOG).toContain("htmlFor={typeId}");
    expect(DIALOG).toContain("htmlFor={noteId}");
    expect(DIALOG).toContain('role="alert"');
    expect(DIALOG).toContain('role="status"');
  });

  it("the menu report item is a keyboard-reachable menuitem button", () => {
    expect(BUTTON).toMatch(/role="menuitem"[\s\S]*?onClick={openReport}/);
  });

  it("never uses a native browser dialog", () => {
    expect(DIALOG).not.toMatch(/\b(?:window|globalThis)\.(?:confirm|alert|prompt)\s*\(/);
    expect(DIALOG).not.toMatch(/(?<![\w.$])(?:confirm|alert|prompt)\s*\(/);
  });
});

describe("Mobile layout does not overflow (#23)", () => {
  it("the card is viewport-bounded and stacks actions on small screens", () => {
    expect(DIALOG_CSS).toContain("calc(100vw - 2rem)");
    expect(DIALOG_CSS).toContain("max-height: calc(100vh - 2rem)");
    expect(DIALOG_CSS).toContain("@media (max-width: 640px)");
    expect(DIALOG_CSS).toContain("grid-template-columns: 1fr");
  });
});
