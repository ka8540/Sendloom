import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  getPlacementOrder,
  getPopoverStyle,
  hasRoom,
  resolvePlacement,
  VIEWPORT_GUTTER,
  type HighlightRect,
  type PopoverSize,
  type ViewportSize
} from "@/components/manual/overlayPosition";
import { getManualForPathname } from "@/manuals";
import { overviewFullSteps, workspaceManual } from "@/manuals/workspaceManual";

// The tour overlay is a "use client" component with React/CSS-module imports, so
// (matching the repo's node test env) layout behaviour is verified two ways:
//   1. real assertions on the extracted, DOM-free positioning math, and
//   2. source assertions that the overlay renders through a body portal and
//      never mutates the target — which together guarantee zero layout impact.
const OVERLAY_SOURCE = readFileSync("src/components/manual/ManualOverlay.tsx", "utf8");
const POSITION_SOURCE = readFileSync("src/components/manual/overlayPosition.ts", "utf8");
const CSS_SOURCE = readFileSync("src/components/manual/manual.module.css", "utf8");

const POPOVER: PopoverSize = { width: 348, height: 300 };

function viewport(width: number, height: number): ViewportSize {
  return { width, height };
}

function rect(partial: Partial<HighlightRect> & Pick<HighlightRect, "left" | "top" | "width" | "height">): HighlightRect {
  const { left, top, width, height } = partial;
  return {
    left,
    top,
    width,
    height,
    right: partial.right ?? left + width,
    bottom: partial.bottom ?? top + height
  };
}

// The exact Sequence Health geometry from the bug screenshot: a wide desktop
// viewport with the visual sitting on the right edge of the analytics card.
const SCREENSHOT_VIEWPORT = viewport(2000, 1200);
const SEQUENCE_HEALTH_RECT = rect({ left: 1180, top: 505, width: 730, height: 155 });

describe("Coachmark renders in a body portal, isolated from the dashboard (#1, #2, #3, #19)", () => {
  it("portals the spotlight + coachmark to document.body", () => {
    expect(OVERLAY_SOURCE).toContain("createPortal");
    expect(OVERLAY_SOURCE).toMatch(/createPortal\(\s*<>/);
    expect(OVERLAY_SOURCE).toMatch(/<\/>,\s*document\.body\s*\)/);
  });

  it("never mutates the target — it only reads its rect and scrolls it into view", () => {
    expect(OVERLAY_SOURCE).not.toMatch(/target\.style/);
    expect(OVERLAY_SOURCE).not.toMatch(/\.style\.(height|width|minHeight|maxHeight|padding|margin|transform)/);
    expect(OVERLAY_SOURCE).not.toMatch(/appendChild|insertBefore|cloneNode|replaceChild/);
    expect(OVERLAY_SOURCE).not.toMatch(/target\.setAttribute|target\.classList/);
    // The only target interactions are measurement + scrolling.
    expect(OVERLAY_SOURCE).toContain("getBoundingClientRect");
    expect(OVERLAY_SOURCE).toContain("scrollIntoView");
  });

  it("does not import Overview/dashboard modules (no layout coupling)", () => {
    expect(OVERLAY_SOURCE).not.toMatch(/from "[^"]*dashboard/);
    expect(OVERLAY_SOURCE).not.toMatch(/from "[^"]*overview/);
    expect(POSITION_SOURCE).not.toMatch(/from "[^"]*(?:dashboard|overview)/);
  });

  it("keeps the spotlight + popover fixed-position (no flow participation) (#4, #5, #6, #7)", () => {
    expect(CSS_SOURCE).toMatch(/\.spotlight\s*\{[^}]*position:\s*fixed/);
    expect(CSS_SOURCE).toMatch(/\.popover\s*\{[^}]*position:\s*fixed/);
  });
});

describe("Reveal uses a minimal, motion-aware scroll (#14, #17)", () => {
  it("reveals targets with block: nearest by default so headings are never clipped", () => {
    expect(workspaceManual.scrollBlock).toBe("nearest");
    // The shared default is now "nearest" for every route (center clipped headings).
    expect(OVERLAY_SOURCE).toContain('manual?.scrollBlock ?? "nearest"');
  });

  it("honours prefers-reduced-motion for scrolling and disables decorative motion", () => {
    expect(OVERLAY_SOURCE).toContain("prefersReducedMotion");
    expect(OVERLAY_SOURCE).toMatch(/prefersReducedMotion\(\)\s*\?\s*"auto"\s*:\s*"smooth"/);
    const reduced = CSS_SOURCE.slice(CSS_SOURCE.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.spotlight[\s\S]*transition:\s*none/);
  });

  it("repositions on resize and scroll, and cleans the listeners up (#8, #12, #13, #14)", () => {
    expect(OVERLAY_SOURCE).toMatch(/addEventListener\("resize"/);
    expect(OVERLAY_SOURCE).toMatch(/addEventListener\("scroll"/);
    expect(OVERLAY_SOURCE).toMatch(/removeEventListener\("resize"/);
    expect(OVERLAY_SOURCE).toMatch(/removeEventListener\("scroll"/);
    // Placement recomputes whenever the step changes (Back/Next).
    expect(OVERLAY_SOURCE).toContain("currentStepIndex");
  });
});

describe("Collision-aware placement flips and stays on screen (#10, #11, #15)", () => {
  it("flips away from a side with no room", () => {
    const hugRight = rect({ left: 1850, top: 560, width: 130, height: 150 });
    // Preferred "right" has no room at the right edge → must flip to a side with room.
    expect(hasRoom(hugRight, "right", SCREENSHOT_VIEWPORT, POPOVER)).toBe(false);
    expect(resolvePlacement(hugRight, "right", SCREENSHOT_VIEWPORT, POPOVER)).not.toBe("right");

    const hugLeft = rect({ left: 20, top: 560, width: 130, height: 150 });
    expect(resolvePlacement(hugLeft, "left", SCREENSHOT_VIEWPORT, POPOVER)).not.toBe("left");

    // The default fallback order starts at the preferred side then flips.
    expect(getPlacementOrder("right")).toEqual(["right", "left", "bottom", "top"]);
  });

  it("never lets the coachmark leave the viewport, even for edge/oversized targets", () => {
    const cases: Array<{ r: HighlightRect; vp: ViewportSize; placement: "right" | "left" | "top" | "bottom" }> = [
      { r: rect({ left: 1940, top: 10, width: 50, height: 40 }), vp: SCREENSHOT_VIEWPORT, placement: "right" },
      { r: rect({ left: -30, top: 1180, width: 60, height: 60 }), vp: SCREENSHOT_VIEWPORT, placement: "left" },
      { r: rect({ left: 600, top: 1190, width: 200, height: 80 }), vp: SCREENSHOT_VIEWPORT, placement: "bottom" },
      { r: rect({ left: 600, top: 0, width: 200, height: 20 }), vp: SCREENSHOT_VIEWPORT, placement: "top" }
    ];
    for (const { r, vp, placement } of cases) {
      const pos = getPopoverStyle(r, placement, vp, POPOVER);
      expect(pos.left).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
      expect(pos.top).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
      expect(pos.left + POPOVER.width).toBeLessThanOrEqual(vp.width - VIEWPORT_GUTTER);
      expect(pos.top + POPOVER.height).toBeLessThanOrEqual(vp.height - VIEWPORT_GUTTER);
    }
  });

  it("centres safely when the target is missing (#15)", () => {
    const pos = getPopoverStyle(null, "left", SCREENSHOT_VIEWPORT, POPOVER);
    expect(pos.left).toBeCloseTo((SCREENSHOT_VIEWPORT.width - POPOVER.width) / 2, 0);
    expect(pos.top).toBeCloseTo((SCREENSHOT_VIEWPORT.height - POPOVER.height) / 2, 0);
  });
});

describe("Sequence Health regression — the exact screenshot state (#4–#9)", () => {
  it("places the coachmark beside the target, on screen, without covering it", () => {
    const pos = getPopoverStyle(SEQUENCE_HEALTH_RECT, "left", SCREENSHOT_VIEWPORT, POPOVER);
    // With room on the left, it sits to the left of the visual...
    expect(resolvePlacement(SEQUENCE_HEALTH_RECT, "left", SCREENSHOT_VIEWPORT, POPOVER)).toBe("left");
    // ...separated from the target (its right edge stays left of the target).
    expect(pos.left + POPOVER.width).toBeLessThanOrEqual(SEQUENCE_HEALTH_RECT.left);
    // ...and fully inside the viewport.
    expect(pos.left).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
    expect(pos.top + POPOVER.height).toBeLessThanOrEqual(SCREENSHOT_VIEWPORT.height - VIEWPORT_GUTTER);
  });

  it("advancing/going back is pure recomputation from each target's rect (no layout writes)", () => {
    const here = getPopoverStyle(SEQUENCE_HEALTH_RECT, "left", SCREENSHOT_VIEWPORT, POPOVER);
    const elsewhere = getPopoverStyle(rect({ left: 120, top: 120, width: 300, height: 120 }), "bottom", SCREENSHOT_VIEWPORT, POPOVER);
    // Different targets → different fixed positions, both valid; the dashboard is
    // never measured or written, so neighbouring cards can't move.
    expect(here).not.toEqual(elsewhere);
    expect(POSITION_SOURCE).not.toMatch(/document|window|getBoundingClientRect|\.style/);
  });
});

describe("Mobile fallback + design preserved (#16, #18, #20)", () => {
  it("the mobile popover is a portal-rendered fixed sheet, not inline flow", () => {
    const mobile = CSS_SOURCE.slice(CSS_SOURCE.indexOf("@media (max-width: 760px)"));
    expect(mobile).toMatch(/\.popover\s*\{[\s\S]*left:\s*1rem/);
    expect(mobile).toMatch(/\.popover\s*\{[\s\S]*bottom:\s*1rem/);
  });

  it("leaves Overview step content + order untouched (#18)", () => {
    // The fix only changed positioning/scroll — steps are identical.
    expect(overviewFullSteps().map((step) => step.id)).toEqual([
      "summary",
      "quick-actions",
      "sequence-search",
      "sequence-actions",
      "gmail-send-window",
      "recent-activity"
    ]);
  });

  it("keeps every route on the shared premium button (never the simple fallback) (#20)", () => {
    for (const path of ["/finder", "/imports", "/templates", "/campaigns", "/prospects"]) {
      const manual = getManualForPathname(path);
      expect(manual?.helpVariant).not.toBe("simple");
    }
  });
});
