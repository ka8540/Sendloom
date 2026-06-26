"use client";

import { X } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

type CircularCloseButtonProps = {
  /** Accessible name, e.g. "Close" or "Close Edit Import". The icon is aria-hidden. */
  label: string;
  /** Smaller circle for compact surfaces (inline notices, toasts). */
  compact?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children" | "type"> & {
  // Allow callers to forward data-* hooks (e.g. the manual overlay's
  // data-manual-control marker used for outside-click detection).
  [dataAttribute: `data-${string}`]: string | undefined;
};

/**
 * The single shared close/dismiss control for the whole app. Every "X" whose
 * semantic action is to close or dismiss an overlay (dialog, sheet, drawer,
 * coachmark, side panel, preview) or a notice renders this, so they all share
 * one circular, equal-sided, theme-aware, keyboard-accessible design. The shape
 * + colors live in the global `.app-close-button` class (globals.css).
 *
 * This is NOT for action buttons that happen to use an X icon (clear-search,
 * cancel-inline-edit, filter-clear) — those keep their own styling.
 */
export function CircularCloseButton({ label, compact, className, ...rest }: CircularCloseButtonProps) {
  const classes = ["app-close-button", compact ? "app-close-button--compact" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={classes} aria-label={label} {...rest}>
      <X aria-hidden="true" />
    </button>
  );
}
