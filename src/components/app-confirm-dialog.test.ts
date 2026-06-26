import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { describeImportDeletion } from "@/components/imports-editor";

// These are "use client" components in a node test env (no DOM), so behavior is
// verified through the pure deletion-copy helper plus source/CSS assertions —
// the same style the rest of the suite uses for client components.
const CONFIRM_SOURCE = readFileSync("src/components/app-confirm-dialog.tsx", "utf8");
const CLOSE_SOURCE = readFileSync("src/components/circular-close-button.tsx", "utf8");
const GLOBALS = readFileSync("src/app/globals.css", "utf8");
const LIBRARY = readFileSync("src/components/mapping-library.tsx", "utf8");
const EDITOR_HELPERS = readFileSync("src/components/imports-editor.ts", "utf8");

function appCloseBlock(): string {
  const start = GLOBALS.indexOf(".app-close-button {");
  return GLOBALS.slice(start, GLOBALS.indexOf(".field-icon-button {", start));
}

// ---------------------------------------------------------------------------
// Shared confirmation dialog
// ---------------------------------------------------------------------------

describe("AppConfirmDialog is an accessible, in-app replacement for native confirm", () => {
  it("portals to the body with alertdialog semantics + a labelled title/description", () => {
    expect(CONFIRM_SOURCE).toContain("createPortal(");
    expect(CONFIRM_SOURCE).toContain("document.body");
    expect(CONFIRM_SOURCE).toContain('role="alertdialog"');
    expect(CONFIRM_SOURCE).toContain('aria-modal="true"');
    expect(CONFIRM_SOURCE).toContain("aria-labelledby={titleId}");
    expect(CONFIRM_SOURCE).toContain("aria-describedby={descId}");
  });

  it("uses no native browser dialog APIs", () => {
    expect(CONFIRM_SOURCE).not.toMatch(/\b(?:window|globalThis)\.(?:confirm|alert|prompt)\s*\(/);
  });

  it("moves initial focus to the safer Cancel control (Enter never confirms)", () => {
    expect(CONFIRM_SOURCE).toContain("cancelRef");
    expect(CONFIRM_SOURCE).toContain("cancelRef.current?.focus()");
    expect(CONFIRM_SOURCE).toMatch(/ref=\{cancelRef\}/);
  });

  it("Escape and the backdrop close via onCancel, and only while not working", () => {
    expect(CONFIRM_SOURCE).toMatch(/event\.key === "Escape" && !loading/);
    expect(CONFIRM_SOURCE).toMatch(/Escape[\s\S]{0,60}onCancel\(\)/);
    expect(CONFIRM_SOURCE).toMatch(/event\.target === event\.currentTarget && !loading/);
  });

  it("runs the action only from the confirm button, with a spinner + loading label", () => {
    expect(CONFIRM_SOURCE).toContain("onClick={() => void onConfirm()}");
    expect(CONFIRM_SOURCE).toContain("resolvedLoadingLabel");
    expect(CONFIRM_SOURCE).toContain("LoaderCircle");
    expect(CONFIRM_SOURCE).toContain("disabled={loading}");
    // Default destructive loading label.
    expect(CONFIRM_SOURCE).toMatch(/Deleting…/);
  });

  it("supports destructive styling and a safe in-dialog error (never raw backend detail)", () => {
    expect(CONFIRM_SOURCE).toContain("confirmDestructive");
    expect(CONFIRM_SOURCE).toMatch(/error \?[\s\S]{0,80}role="alert"/);
  });
});

// ---------------------------------------------------------------------------
// Shared circular close button
// ---------------------------------------------------------------------------

describe("CircularCloseButton is the one shared circular close/dismiss control", () => {
  it("renders a real <button> with the shared class, accessible label, hidden icon", () => {
    expect(CLOSE_SOURCE).toContain('type="button"');
    expect(CLOSE_SOURCE).toContain('"app-close-button"');
    expect(CLOSE_SOURCE).toContain("aria-label={label}");
    expect(CLOSE_SOURCE).toContain('<X aria-hidden="true" />');
  });

  it("is a true circle with equal sides, a visible focus ring, and theme tokens", () => {
    const block = appCloseBlock();
    expect(block).toMatch(/border-radius:\s*9999px/);
    expect(block).toMatch(/width:\s*2\.5rem/);
    expect(block).toMatch(/height:\s*2\.5rem/);
    expect(block).toMatch(/:focus-visible[\s\S]*box-shadow:/);
    expect(block).toMatch(/var\(--/);
    // A compact variant stays an equal-sided circle for tight surfaces.
    expect(GLOBALS).toMatch(/\.app-close-button--compact\s*\{[\s\S]*width:\s*2rem;[\s\S]*height:\s*2rem;/);
  });
});

// ---------------------------------------------------------------------------
// Import deletion — wording + in-app dialog wiring
// ---------------------------------------------------------------------------

describe("Import deletion uses the in-app dialog with correct, safe wording", () => {
  it("uses singular wording for one linked sequence", () => {
    expect(describeImportDeletion({ fileName: "AMD SDE", linkedCampaignCount: 1 })).toBe(
      "Deleting “AMD SDE” will also delete 1 linked sequence. This action cannot be undone."
    );
  });

  it("uses plural wording for multiple linked sequences", () => {
    expect(describeImportDeletion({ fileName: "AMD SDE", linkedCampaignCount: 2 })).toBe(
      "Deleting “AMD SDE” will also delete 2 linked sequences. This action cannot be undone."
    );
  });

  it("uses the no-linked-sequence wording when there are none", () => {
    expect(describeImportDeletion({ fileName: "AMD SDE", linkedCampaignCount: 0 })).toBe(
      "Deleting “AMD SDE” will permanently remove this imported audience. This action cannot be undone."
    );
  });

  it("never embeds a hostname, URL, or 'says' text", () => {
    for (const count of [0, 1, 3]) {
      const text = describeImportDeletion({ fileName: "AMD SDE", linkedCampaignCount: count });
      expect(text).not.toMatch(/sendloom\.net|https?:|\bsays\b/i);
    }
  });

  it("the trash opens the dialog (no delete), confirm runs DELETE once, success refreshes", () => {
    expect(LIBRARY).not.toContain("window.confirm(");
    // Trash only stages the pending deletion — it never mutates.
    expect(LIBRARY).toContain("setPendingDeletion(item)");
    expect(LIBRARY).toContain("<AppConfirmDialog");
    expect(LIBRARY).toContain('confirmLabel="Delete import"');
    expect(LIBRARY).toContain('loadingLabel="Deleting…"');
    // The mutation runs only on confirm, guarded against re-entry, then refreshes.
    expect(LIBRARY).toMatch(/confirmDeleteImport\(\)[\s\S]{0,260}if \(!item \|\| deletingImportId\)/);
    expect(LIBRARY).toContain('method: "DELETE"');
    expect(LIBRARY).toContain("router.refresh()");
  });

  it("a delete failure shows only the safe generic message", () => {
    expect(LIBRARY).toContain("setDeleteError(DELETE_IMPORT_ERROR_MESSAGE)");
    expect(EDITOR_HELPERS).toContain('"This import could not be deleted. Please try again."');
  });
});

// ---------------------------------------------------------------------------
// Close/dismiss X migration coverage (and what must NOT change)
// ---------------------------------------------------------------------------

describe("Every migrated close/dismiss X uses the shared circular control", () => {
  const migratedOverlays = [
    "src/components/mapping-library.tsx",
    "src/components/prospects/prospects-list-view.tsx",
    "src/components/prospects/prospect-detail-view.tsx",
    "src/components/campaign-schedule-editor.tsx",
    "src/components/hunter-dashboard.tsx",
    "src/components/attachment-preview.tsx",
    "src/components/suppressions/suppression-side-panel.tsx",
    "src/components/manual/ManualOverlay.tsx"
  ];

  it("each migrated overlay renders CircularCloseButton instead of a raw <X> close", () => {
    for (const file of migratedOverlays) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("CircularCloseButton");
    }
  });

  it("the Edit Import modal close is the shared circle (the old rounded-square is gone)", () => {
    expect(LIBRARY).toContain('<CircularCloseButton label="Close Edit import"');
    expect(readFileSync("src/components/import-editor-dialog.module.css", "utf8")).not.toContain("closeButton");
  });

  it("does NOT convert non-close action buttons that merely use an X icon (#8)", () => {
    // Clear-search inside the Templates list stays a labelled action button.
    const templates = readFileSync("src/components/templates-workspace.tsx", "utf8");
    expect(templates).toContain('aria-label="Clear template search"');
    expect(templates).not.toMatch(/CircularCloseButton[\s\S]{0,120}Clear template search/);
    // The suppression toolbar's "Clear filters" button is untouched.
    const toolbar = readFileSync("src/components/suppressions/suppression-log-toolbar.tsx", "utf8");
    expect(toolbar).toContain("toolbarClearButton");
    expect(toolbar).not.toContain("CircularCloseButton");
    // The inline "Cancel editing" action (paired with Save) is untouched.
    const setup = readFileSync("src/components/campaign-setup-editor.tsx", "utf8");
    expect(setup).toContain('aria-label="Cancel editing"');
    expect(setup).not.toContain("CircularCloseButton");
  });
});
