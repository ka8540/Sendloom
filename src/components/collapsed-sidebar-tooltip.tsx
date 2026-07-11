"use client";

import { createPortal } from "react-dom";
import { useCallback, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";

const TOOLTIP_GAP = 10;

export function CollapsedSidebarTooltip({ label, children }: { label: string; children: ReactNode }) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const showTooltip = useCallback(() => {
    const rect = targetRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setPosition({
      left: rect.right + TOOLTIP_GAP,
      top: rect.top + rect.height / 2
    });
  }, []);

  const handlePointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") {
      showTooltip();
    }
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setPosition(null);
    }
  };

  return (
    <div
      ref={targetRef}
      className="collapsed-sidebar-tooltip-target"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={() => setPosition(null)}
      onFocusCapture={showTooltip}
      onBlurCapture={handleBlur}
      onClickCapture={() => setPosition(null)}
    >
      {children}
      {position
        ? createPortal(
            <span
              className="collapsed-sidebar-tooltip"
              role="tooltip"
              aria-hidden="true"
              style={{ left: position.left, top: position.top }}
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </div>
  );
}
