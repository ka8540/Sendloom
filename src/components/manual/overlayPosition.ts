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

export const VIEWPORT_GUTTER = 18;
export const TARGET_GAP = 16;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

/**
 * Final, viewport-clamped {left, top} for the fixed-position coachmark. The
 * result is always kept inside the viewport gutter, so the popover can never
 * leave the screen regardless of the target's position.
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
      left: clamp((viewport.width - popoverSize.width) / 2, VIEWPORT_GUTTER, maxLeft),
      top: clamp((viewport.height - popoverSize.height) / 2, VIEWPORT_GUTTER, maxTop)
    };
  }

  const resolvedPlacement = resolvePlacement(rect, placement, viewport, popoverSize);

  let left = rect.left + rect.width / 2 - popoverSize.width / 2;
  let top = rect.bottom + TARGET_GAP;

  if (resolvedPlacement === "top") {
    top = rect.top - popoverSize.height - TARGET_GAP;
  } else if (resolvedPlacement === "right") {
    left = rect.right + TARGET_GAP;
    top = rect.top + rect.height / 2 - popoverSize.height / 2;
  } else if (resolvedPlacement === "left") {
    left = rect.left - popoverSize.width - TARGET_GAP;
    top = rect.top + rect.height / 2 - popoverSize.height / 2;
  }

  return {
    left: clamp(left, VIEWPORT_GUTTER, maxLeft),
    top: clamp(top, VIEWPORT_GUTTER, maxTop)
  };
}
