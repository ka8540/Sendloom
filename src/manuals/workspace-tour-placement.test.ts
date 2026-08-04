import { describe, expect, it } from "vitest";

import {
  getPopoverStyle,
  popoverOverlapsTarget,
  VIEWPORT_GUTTER,
  type HighlightRect,
  type PopoverSize
} from "@/components/manual/overlayPosition";
import { overviewFullSteps } from "@/manuals/workspaceManual";

// Rects measured from the live redesigned Overview at 1440x1000 for BOTH
// sidebar states, fed through the real positioning math.
const VIEWPORT = { width: 1440, height: 1000 };
const POPOVER: PopoverSize = { width: 400, height: 320 };

type Case = { label: string; minLeft: number; rects: Record<string, HighlightRect> };

const CASES: Case[] = [
  {
    label: "sidebar expanded",
    minLeft: 292,
    rects: {
      summary: { top: 32, left: 332, right: 1400, bottom: 147, width: 1068, height: 115 },
      "quick-actions": { top: 171, left: 332, right: 1045, bottom: 339, width: 713, height: 168 },
      "recent-sequences": { top: 365, left: 332, right: 1045, bottom: 854, width: 713, height: 489 },
      "sequence-actions": { top: 524, left: 840, right: 1024, bottom: 564, width: 184, height: 40 },
      "gmail-send-window": { top: 171, left: 1069, right: 1400, bottom: 430, width: 331, height: 258 },
      "recent-activity": { top: 450, left: 1069, right: 1400, bottom: 854, width: 331, height: 404 }
    }
  },
  {
    label: "sidebar collapsed",
    minLeft: 92,
    rects: {
      summary: { top: 32, left: 132, right: 1400, bottom: 147, width: 1268, height: 115 },
      "quick-actions": { top: 171, left: 132, right: 981, bottom: 320, width: 849, height: 149 },
      "recent-sequences": { top: 346, left: 132, right: 981, bottom: 817, width: 849, height: 472 },
      "sequence-actions": { top: 445, left: 705, right: 961, bottom: 485, width: 256, height: 40 },
      "gmail-send-window": { top: 171, left: 1005, right: 1400, bottom: 430, width: 395, height: 258 },
      "recent-activity": { top: 450, left: 1005, right: 1400, bottom: 817, width: 395, height: 368 }
    }
  }
];

describe.each(CASES)("Overview tour placement — $label", ({ minLeft, rects }) => {
  it.each(overviewFullSteps().map((step) => [step.id, step] as const))(
    "step %s is fully on screen, clear of its target and the sidebar",
    (id, step) => {
      const rect = rects[id];
      expect(rect, `measured rect for ${id}`).toBeDefined();

      const pos = getPopoverStyle(rect, step.placement, VIEWPORT, POPOVER, minLeft);

      // Fully inside the viewport gutter.
      expect(pos.left).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
      expect(pos.top).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
      expect(pos.left + POPOVER.width).toBeLessThanOrEqual(VIEWPORT.width - VIEWPORT_GUTTER);
      expect(pos.top + POPOVER.height).toBeLessThanOrEqual(VIEWPORT.height - VIEWPORT_GUTTER);

      // Never covers the component it is explaining.
      expect(popoverOverlapsTarget(pos, POPOVER, rect)).toBe(false);

      // Never sits over the sidebar.
      expect(pos.left).toBeGreaterThanOrEqual(minLeft);
    }
  );
});

describe("Overview tour placement — narrow viewports", () => {
  const narrow: Array<[string, { width: number; height: number }, PopoverSize]> = [
    ["tablet 768x1024", { width: 768, height: 1024 }, { width: 400, height: 340 }],
    ["mobile 375x812", { width: 375, height: 812 }, { width: 335, height: 380 }]
  ];

  it.each(narrow)("stays on screen at %s", (_label, viewport, popover) => {
    // A worst-case target: a wide band low on the page.
    const rect: HighlightRect = {
      top: viewport.height - 220,
      left: 16,
      right: viewport.width - 16,
      bottom: viewport.height - 120,
      width: viewport.width - 32,
      height: 100
    };
    for (const step of overviewFullSteps()) {
      const pos = getPopoverStyle(rect, step.placement, viewport, popover, VIEWPORT_GUTTER);
      expect(pos.left).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
      expect(pos.top).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
      expect(pos.left + popover.width).toBeLessThanOrEqual(viewport.width - VIEWPORT_GUTTER);
      expect(pos.top + popover.height).toBeLessThanOrEqual(viewport.height - VIEWPORT_GUTTER);
    }
  });
});
