"use client";

import { CircleHelp } from "lucide-react";

import { useManual } from "@/components/manual/ManualProvider";
import styles from "@/components/manual/manual.module.css";

export function ManualButton() {
  const { isOpen, manual, openManual } = useManual();

  if (!manual || isOpen) {
    return null;
  }

  const label = manual.helpLabel ?? "Help";
  const tooltip = manual.helpTooltip ?? "Help";

  return (
    <button
      className={styles.helpButton}
      type="button"
      onClick={openManual}
      aria-label={label}
      data-manual-help-button="true"
    >
      <CircleHelp aria-hidden="true" />
      <span className={styles.helpTooltip} aria-hidden="true">
        {tooltip}
      </span>
    </button>
  );
}
