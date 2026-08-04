import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  getPopoverStyle,
  hasRoom,
  popoverOverlapsTarget,
  TARGET_GAP,
  VIEWPORT_GUTTER,
  type HighlightRect,
  type PopoverSize,
  type ViewportSize
} from "@/components/manual/overlayPosition";
import { getManualForPathname } from "@/manuals";
import { overviewFullSteps } from "@/manuals/workspaceManual";

// The coachmark is a "use client" component (node test env, no DOM), so card
// layout is verified through CSS/source assertions, and placement is verified
// through the pure positioning math. VIEWPORT_GUTTER is the 20px viewport pad.
const CSS_SOURCE = readFileSync("src/components/manual/manual.module.css", "utf8");
const OVERLAY_SOURCE = readFileSync("src/components/manual/ManualOverlay.tsx", "utf8");
const POSITION_SOURCE = readFileSync("src/components/manual/overlayPosition.ts", "utf8");

const POPOVER: PopoverSize = { width: 400, height: 340 };

function viewport(width: number, height: number): ViewportSize {
  return { width, height };
}

function rect(left: number, top: number, width: number, height: number): HighlightRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function withinViewport(pos: { left: number; top: number }, vp: ViewportSize, size: PopoverSize) {
  const slack = 0.5;
  return (
    pos.left >= VIEWPORT_GUTTER - slack &&
    pos.top >= VIEWPORT_GUTTER - slack &&
    pos.left + size.width <= vp.width - VIEWPORT_GUTTER + slack &&
    pos.top + size.height <= vp.height - VIEWPORT_GUTTER + slack
  );
}

// Read the body of a CSS class block by name.
function cssBlock(name: string): string {
  const start = CSS_SOURCE.indexOf(`.${name} {`);
  if (start === -1) return "";
  return CSS_SOURCE.slice(start, CSS_SOURCE.indexOf("}", start));
}

describe("Coachmark card is readable: text wraps, controls stay inside (#1–#8, #18)", () => {
  it("body text wraps and is never truncated or line-clamped (#1, #2, #3)", () => {
    const copy = cssBlock("copy");
    const h2 = CSS_SOURCE.slice(CSS_SOURCE.indexOf(".copy h2 {"), CSS_SOURCE.indexOf("}", CSS_SOURCE.indexOf(".copy h2 {")));
    const p = CSS_SOURCE.slice(CSS_SOURCE.indexOf(".copy p {"), CSS_SOURCE.indexOf("}", CSS_SOURCE.indexOf(".copy p {")));
    for (const block of [copy, h2, p]) {
      expect(block).not.toMatch(/white-space:\s*nowrap/);
      expect(block).not.toMatch(/text-overflow:\s*ellipsis/);
      expect(block).not.toMatch(/line-clamp/);
    }
    expect(h2).toMatch(/overflow-wrap:\s*break-word/);
    expect(p).toMatch(/overflow-wrap:\s*break-word/);
  });

  it("uses a flex column with a wrapping width derived from the viewport, not the target (#8)", () => {
    const popover = cssBlock("popover");
    expect(popover).toMatch(/display:\s*flex/);
    expect(popover).toMatch(/flex-direction:\s*column/);
    expect(popover).toMatch(/box-sizing:\s*border-box/);
    expect(popover).toMatch(/width:\s*min\(25rem,\s*calc\(100vw - 40px\)\)/);
    expect(popover).toMatch(/max-height:\s*calc\(100vh - 40px\)/);
    // The card itself never scrolls horizontally.
    expect(popover).toMatch(/overflow:\s*hidden/);
  });

  it("scrolls only the body vertically and keeps header + footer pinned (#4, #18)", () => {
    expect(cssBlock("copy")).toMatch(/overflow-y:\s*auto/);
    expect(cssBlock("copy")).toMatch(/min-height:\s*0/);
    expect(cssBlock("copy")).toMatch(/flex:\s*1 1 auto/);
    expect(cssBlock("popoverTop")).toMatch(/flex-shrink:\s*0/);
    expect(cssBlock("popoverFooter")).toMatch(/flex-shrink:\s*0/);
  });

  it("keeps the close, Skip and Next controls from shrinking/clipping (#4, #5, #6, #7)", () => {
    const buttons = CSS_SOURCE.slice(CSS_SOURCE.indexOf(".skipButton,"));
    expect(buttons).toMatch(/flex-shrink:\s*0/);
    // The close button lives in the header row, never absolutely positioned over text.
    expect(cssBlock("iconButton")).not.toMatch(/position:\s*absolute/);
    // Progress dots wrap rather than forcing horizontal overflow.
    expect(cssBlock("progressRow")).toMatch(/flex-wrap:\s*wrap/);
    // The footer groups progress + actions and the Next arrow is still rendered.
    expect(OVERLAY_SOURCE).toContain("popoverFooter");
    expect(OVERLAY_SOURCE).toMatch(/Next[\s\S]{0,40}ArrowRight/);
  });
});

describe("Placement stays on screen and off the target (#9, #10, #11, #14)", () => {
  const vp = viewport(1280, 800);

  it("clamps every placement at least 20px inside the viewport (#9)", () => {
    const targets: HighlightRect[] = [
      rect(40, 40, 120, 80),
      rect(1180, 40, 80, 80),
      rect(40, 700, 200, 80),
      rect(1120, 700, 140, 80),
      rect(560, 380, 220, 120)
    ];
    for (const placement of ["bottom", "top", "left", "right"] as const) {
      for (const target of targets) {
        const pos = getPopoverStyle(target, placement, vp, POPOVER);
        expect(withinViewport(pos, vp, POPOVER)).toBe(true);
      }
    }
  });

  it("flips away from the right edge instead of overflowing it (#10)", () => {
    const hugRight = rect(1180, 320, 80, 120);
    expect(hasRoom(hugRight, "right", vp, POPOVER)).toBe(false);
    const pos = getPopoverStyle(hugRight, "right", vp, POPOVER);
    expect(pos.left + POPOVER.width).toBeLessThanOrEqual(vp.width - VIEWPORT_GUTTER + 0.5);
    expect(popoverOverlapsTarget(pos, POPOVER, hugRight)).toBe(false);
  });

  it("does not cover the target when a side has room, and sits beside it (#11, #14)", () => {
    const target = rect(540, 200, 240, 130);
    const pos = getPopoverStyle(target, "bottom", vp, POPOVER);
    expect(popoverOverlapsTarget(pos, POPOVER, target)).toBe(false);
    // With room below, it sits a gap beneath the target (beside it, not detached
    // over the analytics).
    expect(pos.top).toBeCloseTo(target.bottom + TARGET_GAP, 0);
  });

  it("falls back to a fully on-screen detached position when no side fits (#9, #11)", () => {
    // A target filling the viewport centre leaves no clean side; the card must
    // still render entirely on screen. Every real Overview target has a clear
    // side (asserted by the templates-live + sits-beside cases) — overlap is
    // unavoidable only for a target this large.
    const banner = rect(40, 120, 1200, 360);
    const pos = getPopoverStyle(banner, "bottom", vp, POPOVER);
    expect(withinViewport(pos, vp, POPOVER)).toBe(true);
  });
});

describe("Summary-strip regression — the screenshot step (#12, #13)", () => {
  it("the summary step exists and its copy matches the strip (#21)", () => {
    const step = overviewFullSteps().find((entry) => entry.id === "summary");
    expect(step?.title).toBe("Overview at a glance");
    expect(step?.body).toMatch(/ready to launch/);
  });

  it("is fully visible and never covers the summary strip it explains (#12, #13)", () => {
    const vp = viewport(1366, 768);
    // The summary strip: full-width band near the top of the content column.
    const summaryStrip = rect(320, 140, 1000, 120);
    for (const placement of ["bottom", "top", "right", "left"] as const) {
      const pos = getPopoverStyle(summaryStrip, placement, vp, POPOVER);
      expect(withinViewport(pos, vp, POPOVER)).toBe(true);
      expect(popoverOverlapsTarget(pos, POPOVER, summaryStrip)).toBe(false);
    }
  });
});

describe("Responsive + reposition + isolation preserved (#15–#20, #22)", () => {
  it("recalculates on resize, scroll, and ResizeObserver (sidebar/content/fonts) (#15, #16, #17)", () => {
    expect(OVERLAY_SOURCE).toMatch(/addEventListener\("resize"/);
    expect(OVERLAY_SOURCE).toMatch(/addEventListener\("scroll"/);
    expect(OVERLAY_SOURCE).toContain("ResizeObserver");
    expect(OVERLAY_SOURCE).toMatch(/resizeObserver\.observe/);
    expect(OVERLAY_SOURCE).toMatch(/resizeObserver\?\.disconnect\(\)/);
  });

  it("measures the viewport without the scrollbar (#9)", () => {
    expect(OVERLAY_SOURCE).toContain("document.documentElement.clientWidth");
  });

  it("stays inside a small mobile viewport and remains a portal-rendered fixed sheet (#19)", () => {
    const vpMobile = viewport(375, 667);
    const mobileTarget = rect(20, 300, 335, 120);
    const sizeMobile: PopoverSize = { width: 335, height: 320 };
    for (const placement of ["bottom", "top", "left", "right"] as const) {
      const pos = getPopoverStyle(mobileTarget, placement, vpMobile, sizeMobile);
      expect(withinViewport(pos, vpMobile, sizeMobile)).toBe(true);
    }
    const mobile = CSS_SOURCE.slice(CSS_SOURCE.indexOf("@media (max-width: 760px)"));
    expect(mobile).toMatch(/\.popover\s*\{[\s\S]*left:\s*1rem/);
  });

  it("keeps the layout-isolation fix: portal + no target mutation (#20)", () => {
    expect(OVERLAY_SOURCE).toMatch(/createPortal\(/);
    expect(OVERLAY_SOURCE).toMatch(/document\.body\s*\)/);
    expect(OVERLAY_SOURCE).not.toMatch(/target\.style|\.style\.(height|width|padding|margin)/);
    // Positioning math stays DOM-free.
    expect(POSITION_SOURCE).not.toMatch(/document|window|\.style/);
  });

  it("does not change tour content/order or any other guide (#21, #22)", () => {
    // Step set + order is untouched by this presentation fix.
    expect(overviewFullSteps()[0].id).toBe("summary");
    expect(overviewFullSteps().some((s) => s.id === "gmail-send-window")).toBe(true);
    for (const path of ["/finder", "/imports", "/templates", "/campaigns", "/prospects"]) {
      const manual = getManualForPathname(path);
      expect(manual?.helpVariant).not.toBe("simple");
    }
  });
});
