import type { ComponentPropsWithoutRef, ReactNode } from "react";

import styles from "@/components/workspace-page-header.module.css";

type WorkspacePageHeaderProps = Omit<ComponentPropsWithoutRef<"header">, "children"> & {
  title: string;
  subtitle: string;
  actions?: ReactNode;
};

/**
 * The canonical header for main workspace pages. Its layout and typography
 * come directly from the Sequences dashboard so list/dashboard pages stay
 * aligned without maintaining page-specific title systems.
 */
export function WorkspacePageHeader({
  title,
  subtitle,
  actions,
  className,
  ...headerProps
}: WorkspacePageHeaderProps) {
  return (
    <header
      {...headerProps}
      className={className ? `${styles.header} ${className}` : styles.header}
    >
      <div className={styles.heading}>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
