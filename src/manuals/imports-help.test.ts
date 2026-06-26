import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { filterAvailableManualSteps } from "@/components/manual/manualSteps";
import {
  getPopoverStyle,
  popoverOverlapsTarget,
  VIEWPORT_GUTTER,
  type HighlightRect,
  type PopoverSize,
  type ViewportSize
} from "@/components/manual/overlayPosition";
import type { ManualStep } from "@/components/manual/manualTypes";
import { getManualForPathname } from "@/manuals";
import {
  importsChangedSteps,
  importsFullSteps,
  importsManual,
  importsQuickSteps,
  importsStepsForStage
} from "@/manuals/importsManual";

const IMPORTS_SOURCE = readFileSync("src/manuals/importsManual.ts", "utf8");
const LIBRARY_SOURCE = readFileSync("src/components/mapping-library.tsx", "utf8");
const PAGE_SOURCE = readFileSync("src/app/(app)/imports/page.tsx", "utf8");

function ids(steps: ManualStep[]): string[] {
  return steps.map((step) => step.id);
}

function allText(steps: ManualStep[]): string {
  return steps.map((step) => `${step.title} ${step.body}`).join(" ");
}

function sel(target: string): string {
  return `[data-imports-tour="${target}"]`;
}

function rect(left: number, top: number, width: number, height: number): HighlightRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

// --------------------------------------------------------------------------
// Registration + shape
// --------------------------------------------------------------------------

describe("Imports keeps the shared premium guide menu (unchanged registration)", () => {
  it("registers the premium quick + full menu on /imports", () => {
    expect(getManualForPathname("/imports")).toBe(importsManual);
    expect(importsManual.id).toBe("imports");
    expect(importsManual.helpVariant).toBe("premium");
    expect(importsManual.helpQuickStart).toBe(true);
    expect(importsManual.quickStartStage).toBe("starter");
    expect(importsManual.fullTourStage).toBe("full");
    expect(importsManual.helpLabel).toBe("Help with Imports");
    expect(importsManual.helpTooltip).toBe("Imports guide");
  });

  it("Quick start is short and the Full page tour is longer + distinct", () => {
    const quick = importsStepsForStage("starter");
    const full = importsStepsForStage("full");
    expect(quick.length).toBeGreaterThan(0);
    expect(full.length).toBeGreaterThan(quick.length);
    expect(importsStepsForStage("changed").length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// The unified pencil editor is the headline of the guide
// --------------------------------------------------------------------------

describe("Full page tour explains the unified pencil editor (#1, #2)", () => {
  it("includes the edit-import step pointed at the pencil target (#1)", () => {
    const step = importsFullSteps().find((entry) => entry.id === "edit-import");
    expect(step).toBeTruthy();
    expect(step?.selector).toBe(sel("edit-import"));
  });

  it("the edit step explains BOTH name and field editing and reassures on contacts + sequences (#2)", () => {
    const body = importsFullSteps().find((entry) => entry.id === "edit-import")?.body.toLowerCase() ?? "";
    expect(body).toContain("pencil");
    expect(body).toContain("rename");
    expect(body).toMatch(/active template fields|template fields/);
    expect(body).toContain("contacts");
    expect(body).toContain("sequence");
  });
});

describe("No Imports guide references the removed Edit fields button (#3)", () => {
  it("never mentions an Edit fields button in any stage or in the source", () => {
    const text = allText([...importsQuickSteps(), ...importsFullSteps(), ...importsChangedSteps()]);
    expect(text).not.toMatch(/edit fields/i);
    expect(IMPORTS_SOURCE).not.toMatch(/edit fields/i);
    // It also must not use the old internal "operators review records" wording.
    expect(text).not.toMatch(/operators? review records/i);
  });
});

describe("Active + Other column guidance both route changes to the pencil (#4, #5)", () => {
  it("Active template fields step sends field changes to the pencil (#4)", () => {
    const step = importsFullSteps().find((entry) => entry.id === "active-template-fields");
    expect(step?.selector).toBe(sel("active-template-fields"));
    expect(step?.body.toLowerCase()).toContain("pencil");
  });

  it("Other detected columns step sends activation to the pencil (#5)", () => {
    const step = importsFullSteps().find((entry) => entry.id === "other-detected-columns");
    expect(step?.selector).toBe(sel("other-detected-columns"));
    expect(step?.body.toLowerCase()).toContain("pencil");
  });
});

describe("Sample contacts + delete are explained with accurate behavior", () => {
  it("sample contacts step previews without modifying the list", () => {
    const step = importsFullSteps().find((entry) => entry.id === "sample-contacts");
    expect(step?.selector).toBe(sel("sample-contacts"));
    expect(step?.body.toLowerCase()).toMatch(/quick check|preview/);
  });

  it("delete step explains the confirm + that built sequences are removed (real behavior)", () => {
    const step = importsFullSteps().find((entry) => entry.id === "delete-import");
    const body = step?.body.toLowerCase() ?? "";
    expect(body).toContain("confirm");
    expect(body).toContain("sequence");
  });
});

// --------------------------------------------------------------------------
// State-dependent steps skip safely
// --------------------------------------------------------------------------

describe("State-dependent steps are optional and skipped safely (#6, #8)", () => {
  it("every processed-card + pending-picker step is optional", () => {
    const optionalIds = [
      "pending-selector",
      "active-field-selection",
      "save-template-fields",
      "import-card",
      "active-template-fields",
      "other-detected-columns",
      "sample-contacts",
      "edit-import",
      "delete-import",
      "imports-pagination"
    ];
    for (const id of optionalIds) {
      expect(importsFullSteps().find((entry) => entry.id === id)?.optional).toBe(true);
    }
  });

  it("drops the pencil + card steps when there is no processed import (#6)", () => {
    const present = new Set([sel("upload"), sel("template-fields"), sel("imports-list")]);
    const shown = ids(filterAvailableManualSteps(importsFullSteps(), (selector) => present.has(selector)));
    expect(shown).toContain("upload");
    expect(shown).toContain("imports-list");
    expect(shown).not.toContain("edit-import");
    expect(shown).not.toContain("active-template-fields");
    expect(shown).not.toContain("other-detected-columns");
  });

  it("keeps the pencil + card steps when a processed card is present (#1)", () => {
    const present = new Set(
      ["upload", "template-fields", "imports-list", "import-card", "edit-import", "active-template-fields", "sample-contacts", "delete-import"].map(sel)
    );
    const shown = ids(filterAvailableManualSteps(importsFullSteps(), (selector) => present.has(selector)));
    expect(shown).toContain("edit-import");
    expect(shown).toContain("active-template-fields");
    expect(shown).toContain("sample-contacts");
  });

  it("Quick start hides the pencil step until a processed import exists (#6)", () => {
    const quick = importsQuickSteps();
    expect(quick.find((entry) => entry.id === "edit-import")?.optional).toBe(true);

    const empty = new Set([sel("upload"), sel("template-fields"), sel("imports-list")]);
    expect(ids(filterAvailableManualSteps(quick, (selector) => empty.has(selector)))).not.toContain("edit-import");

    const ready = new Set([sel("upload"), sel("template-fields"), sel("imports-list"), sel("edit-import")]);
    expect(ids(filterAvailableManualSteps(quick, (selector) => ready.has(selector)))).toContain("edit-import");
  });
});

// --------------------------------------------------------------------------
// "What changed"
// --------------------------------------------------------------------------

describe("What changed explains editing after the first processed import (#7)", () => {
  it("covers the list placement, both-edit pencil, sample preview, and sequence usage", () => {
    const changed = importsChangedSteps();
    expect(ids(changed)).toContain("edit-import");
    const text = allText(changed).toLowerCase();
    expect(text).toContain("rename");
    expect(text).toMatch(/active template fields|template fields/);
    expect(text).toContain("sample contacts");
    expect(text).toContain("sequence");
  });

  it("the processed list publishes the 'what changed' marker once a card exists", () => {
    expect(LIBRARY_SOURCE).toContain("dataset.tourChangedStage");
    expect(LIBRARY_SOURCE).toMatch(/props\.items\.length > 0/);
  });
});

// --------------------------------------------------------------------------
// Targets are actually rendered
// --------------------------------------------------------------------------

describe("Every targeted element is declared in the Imports surfaces", () => {
  it("the page declares the always-present targets", () => {
    for (const target of ["upload", "template-fields", "imports-list"]) {
      expect(PAGE_SOURCE).toContain(`data-imports-tour="${target}"`);
    }
  });

  it("the card declares the processed-import + pagination targets (static or first-card anchored)", () => {
    for (const target of [
      "import-card",
      "edit-import",
      "active-template-fields",
      "other-detected-columns",
      "sample-contacts",
      "delete-import",
      "imports-pagination"
    ]) {
      expect(LIBRARY_SOURCE).toContain(`"${target}"`);
    }
  });

  it("the pending picker declares its full-tour targets", () => {
    for (const target of ["pending-selector", "active-field-selection", "save-template-fields"]) {
      expect(LIBRARY_SOURCE).toContain(`data-imports-tour="${target}"`);
    }
  });
});

// --------------------------------------------------------------------------
// Coachmark placement — stays off the pencil, never resizes the card
// --------------------------------------------------------------------------

describe("Coachmark stays on screen, off the pencil, and never resizes the card (#9, #10)", () => {
  const vp: ViewportSize = { width: 1440, height: 900 };
  const pop: PopoverSize = { width: 400, height: 320 };
  // An icon-only pencil near the card's top-right edge.
  const pencil = rect(1180, 240, 40, 40);

  it("places the edit-import coachmark beside the pencil without covering it, sidebar open or closed (#10)", () => {
    for (const sidebar of [VIEWPORT_GUTTER, 300]) {
      for (const placement of ["left", "bottom", "top", "right"] as const) {
        const pos = getPopoverStyle(pencil, placement, vp, pop, sidebar);
        // On-screen, right of the (optional) sidebar.
        expect(pos.left).toBeGreaterThanOrEqual(sidebar - 0.5);
        expect(pos.left + pop.width).toBeLessThanOrEqual(vp.width - VIEWPORT_GUTTER + 0.5);
        expect(pos.top).toBeGreaterThanOrEqual(VIEWPORT_GUTTER - 0.5);
        expect(pos.top + pop.height).toBeLessThanOrEqual(vp.height - VIEWPORT_GUTTER + 0.5);
        // Never sits on top of the pencil it explains (a clear side always exists).
        expect(popoverOverlapsTarget(pos, pop, pencil)).toBe(false);
      }
    }
  });

  it("the overlay is a body portal and never mutates the highlighted card's box (#9)", () => {
    const overlay = readFileSync("src/components/manual/ManualOverlay.tsx", "utf8");
    expect(overlay).toMatch(/createPortal\(/);
    expect(overlay).not.toMatch(/\.style\.(height|width|padding|margin)/);
  });
});
