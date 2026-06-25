import type { ManualPlacement } from "@/components/manual/manualTypes";

// Pure, DOM-free positioning math for the manual coachmark. Extracted from
// ManualOverlay so the collision-aware placement and viewport clamping can be
// unit-tested without a browser, and so the overlay component stays focused on
// portal rendering + lifecycle. Behaviour is identical to the previous inline
// implementation.

export type HighlightRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

export type ViewportSize = {
  height: number;
  width: number;
};

export type PopoverSize = {
  height: number;
  width: number;
};

export type PopoverPosition = {
  left: number;
  top: number;
};

export const VIEWPORT_GUTTER = 20;
export const TARGET_GAP = 16;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

/** Whether a positioned popover box would cover any part of the target rect. */
export function popoverOverlapsTarget(pos: PopoverPosition, popoverSize: PopoverSize, target: HighlightRect) {
  return (
    rangesOverlap(pos.left, pos.left + popoverSize.width, target.left, target.right) &&
    rangesOverlap(pos.top, pos.top + popoverSize.height, target.top, target.bottom)
  );
}

export function getPlacementOrder(placement: ManualPlacement | undefined) {
  const preferred = placement ?? "bottom";

  if (preferred === "center") {
    return ["center"] as const;
  }

  const fallbacks = {
    bottom: ["bottom", "top", "right", "left"],
    top: ["top", "bottom", "right", "left"],
    right: ["right", "left", "bottom", "top"],
    left: ["left", "right", "bottom", "top"]
  } as const;

  return fallbacks[preferred];
}

export function hasRoom(
  rect: HighlightRect,
  placement: Exclude<ManualPlacement, "center">,
  viewport: ViewportSize,
  popoverSize: PopoverSize
) {
  if (placement === "bottom") {
    return rect.bottom + TARGET_GAP + popoverSize.height <= viewport.height - VIEWPORT_GUTTER;
  }

  if (placement === "top") {
    return rect.top - TARGET_GAP - popoverSize.height >= VIEWPORT_GUTTER;
  }

  if (placement === "right") {
    return rect.right + TARGET_GAP + popoverSize.width <= viewport.width - VIEWPORT_GUTTER;
  }

  return rect.left - TARGET_GAP - popoverSize.width >= VIEWPORT_GUTTER;
}

/**
 * Resolve the first placement (preferred, then its fallbacks) that fits without
 * clipping. Falls back to the preferred side when nothing fits, so the popover
 * is then clamped into the viewport by {@link getPopoverStyle}.
 */
export function resolvePlacement(
  rect: HighlightRect,
  placement: ManualPlacement | undefined,
  viewport: ViewportSize,
  popoverSize: PopoverSize
): Exclude<ManualPlacement, "center"> {
  const placementOrder = getPlacementOrder(placement);

  return (
    placementOrder.find(
      (item): item is Exclude<ManualPlacement, "center"> =>
        item !== "center" && hasRoom(rect, item, viewport, popoverSize)
    ) ?? (placementOrder[0] === "center" ? "bottom" : placementOrder[0])
  );
}

function centeredLeft(viewport: ViewportSize, popoverSize: PopoverSize, maxLeft: number) {
  return clamp((viewport.width - popoverSize.width) / 2, VIEWPORT_GUTTER, maxLeft);
}

/**
 * Detached fallback used only when no side has genuine room: a viewport
 * top-/bottom-centred position that is fully on screen and never sits across the
 * target. It picks the band (top or bottom) in the half opposite the target's
 * centre, so the highlighted element stays visible while it is explained.
 */
function detachedFallback(
  rect: HighlightRect,
  viewport: ViewportSize,
  popoverSize: PopoverSize,
  maxLeft: number,
  maxTop: number
): PopoverPosition {
  const left = centeredLeft(viewport, popoverSize, maxLeft);
  const bottomBand = clamp(viewport.height - popoverSize.height - VIEWPORT_GUTTER, VIEWPORT_GUTTER, maxTop);
  const topBand = clamp(VIEWPORT_GUTTER, VIEWPORT_GUTTER, maxTop);
  const targetMidY = (rect.top + rect.bottom) / 2;

  let top = targetMidY < viewport.height / 2 ? bottomBand : topBand;
  const candidate: PopoverPosition = { left, top };
  if (popoverOverlapsTarget(candidate, popoverSize, rect)) {
    const alternative = top === bottomBand ? topBand : bottomBand;
    if (!popoverOverlapsTarget({ left, top: alternative }, popoverSize, rect)) {
      top = alternative;
    }
  }
  return { left, top };
}

/**
 * Final, viewport-clamped {left, top} for the fixed-position coachmark. It is
 * placed beside the target on the first side (preferred, then fallbacks) that
 * has genuine room. When no side fits without covering the target, it drops to a
 * detached top-/bottom-centred fallback. The result is always kept inside the
 * viewport gutter, so the popover can never leave the screen or sit on top of
 * the element it is explaining when a clear spot exists.
 */
export function getPopoverStyle(
  rect: HighlightRect | null,
  placement: ManualPlacement | undefined,
  viewport: ViewportSize,
  popoverSize: PopoverSize
): PopoverPosition {
  const maxLeft = Math.max(VIEWPORT_GUTTER, viewport.width - popoverSize.width - VIEWPORT_GUTTER);
  const maxTop = Math.max(VIEWPORT_GUTTER, viewport.height - popoverSize.height - VIEWPORT_GUTTER);

  if (!rect || placement === "center") {
    return {
      left: centeredLeft(viewport, popoverSize, maxLeft),
      top: clamp((viewport.height - popoverSize.height) / 2, VIEWPORT_GUTTER, maxTop)
    };
  }

  // Only place beside the target on a side that genuinely fits (target + gap +
  // popover within the viewport). A side that merely "exists" but would clamp
  // the popover back over the target is rejected in favour of the fallback.
  const fittingPlacement = getPlacementOrder(placement).find(
    (item): item is Exclude<ManualPlacement, "center"> =>
      item !== "center" && hasRoom(rect, item, viewport, popoverSize)
  );

  if (!fittingPlacement) {
    return detachedFallback(rect, viewport, popoverSize, maxLeft, maxTop);
  }

  let left = rect.left + rect.width / 2 - popoverSize.width / 2;
  let top = rect.bottom + TARGET_GAP;

  if (fittingPlacement === "top") {
    top = rect.top - popoverSize.height - TARGET_GAP;
  } else if (fittingPlacement === "right") {
    left = rect.right + TARGET_GAP;
    top = rect.top + rect.height / 2 - popoverSize.height / 2;
  } else if (fittingPlacement === "left") {
    left = rect.left - popoverSize.width - TARGET_GAP;
    top = rect.top + rect.height / 2 - popoverSize.height / 2;
  }

  return {
    left: clamp(left, VIEWPORT_GUTTER, maxLeft),
    top: clamp(top, VIEWPORT_GUTTER, maxTop)
  };
}
