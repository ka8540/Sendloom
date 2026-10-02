"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import React, { type ReactNode, type Ref } from "react";
import styles from "./account-settings-section.module.css";

export function AccountSettingsSection({
  id, title, description, icon: Icon, expanded, onToggle, children, meta, danger = false, headerRef,
}: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  meta?: string;
  danger?: boolean;
  headerRef?: Ref<HTMLButtonElement>;
}) {
  const panelId = `account-settings-${id}`;
  return (
    <section className={styles.section} aria-label={title}>
      <button
        ref={headerRef}
        type="button"
        className={`${styles.trigger}${danger ? ` ${styles.danger}` : ""}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className={styles.icon}><Icon aria-hidden="true" /></span>
        <span className={styles.copy}>
          <span className={styles.title}>{title}</span>
          <span className={styles.description}>{description}</span>
        </span>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
        <ChevronDown className={`${styles.chevron}${expanded ? ` ${styles.chevronOpen}` : ""}`} aria-hidden="true" />
      </button>
      <div id={panelId} className={styles.body} hidden={!expanded}>{children}</div>
    </section>
  );
}
