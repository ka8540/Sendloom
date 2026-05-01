"use client";

import { CircleHelp } from "lucide-react";

import { useManual } from "@/components/manual/ManualProvider";
import styles from "@/components/manual/manual.module.css";

export function ManualButton() {
  const { isOpen, manual, openManual } = useManual();

  if (!manual || isOpen) {
    return null;
  }

  return (
    <button className={styles.helpButton} type="button" onClick={openManual} aria-label={`Open ${manual.routeLabel} manual`}>
      <CircleHelp aria-hidden="true" />
      <span>Help</span>
    </button>
  );
}
