import type { ManualStep } from "@/components/manual/manualTypes";

/**
 * Keep every non-optional step (these render centered when their target is
 * missing, matching the default manual behavior) and keep an optional step only
 * when its target is present. If filtering removes everything, fall back to the
 * original list so a tour is never opened empty. Pure + injectable so it can be
 * unit-tested without a DOM.
 */
export function filterAvailableManualSteps(
  steps: ManualStep[],
  isTargetPresent: (selector: string) => boolean
): ManualStep[] {
  const filtered = steps.filter((step) => {
    if (!step.optional) {
      return true;
    }
    if (!step.selector) {
      return false;
    }
    return isTargetPresent(step.selector);
  });

  return filtered.length > 0 ? filtered : steps;
}

/** DOM-backed presence check used at runtime (visible, non-zero-size element). */
export function isManualTargetPresent(selector: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const target = document.querySelector(selector);
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const rect = target.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
