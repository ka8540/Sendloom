import type { Route } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./admin-ui.module.css";

export function AdminShell({ children }: { children: ReactNode }) {
  return <div className={styles.shell}>{children}</div>;
}

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>{eyebrow ?? "SENDLOOM / ADMIN"}</p>
        <h1>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

export function AdminTabs({
  items,
  active,
}: {
  items: Array<{ label: string; href: string }>;
  active: string;
}) {
  return (
    <nav className={styles.tabs} aria-label="Workspace sections">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href as Route}
          aria-current={active === item.href ? "page" : undefined}
          className={active === item.href ? styles.tabActive : styles.tab}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function AdminMetricStrip({
  items,
}: {
  items: Array<{
    label: string;
    value: number | string;
    note?: string;
    tone?: "warning" | "danger";
  }>;
}) {
  return (
    <section className={styles.metrics} aria-label="Key metrics">
      {items.map((item) => (
        <div className={styles.metric} key={item.label}>
          <span>{item.label}</span>
          <strong
            className={
              item.tone === "danger"
                ? styles.dangerText
                : item.tone === "warning"
                  ? styles.warningText
                  : undefined
            }
          >
            {typeof item.value === "number"
              ? item.value.toLocaleString()
              : item.value}
          </strong>
          {item.note && <small>{item.note}</small>}
        </div>
      ))}
    </section>
  );
}

export function AdminSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AdminStatusBadge({
  status,
  tone = "neutral",
}: {
  status: string;
  tone?: "healthy" | "warning" | "danger" | "neutral";
}) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      <span className={styles.statusDot} aria-hidden="true" />
      {status}
    </span>
  );
}

export function AdminEmptyState({ children }: { children: ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}

export function AdminErrorState({ children }: { children: ReactNode }) {
  return (
    <div className={styles.error} role="alert">
      {children}
    </div>
  );
}

export function AdminTable({
  headings,
  children,
}: {
  headings: string[];
  children: ReactNode;
}) {
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading} scope="col">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const adminUiStyles = styles;
