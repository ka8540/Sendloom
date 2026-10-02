import type { Route } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
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
  id,
  title,
  description,
  action,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} id={id}>
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

export function AdminSearchInput({
  name = "q",
  value,
  placeholder,
  label,
}: {
  name?: string;
  value: string;
  placeholder: string;
  label: string;
}) {
  return (
    <label className={styles.searchField}>
      <Search size={17} aria-hidden="true" />
      <input
        type="search"
        name={name}
        defaultValue={value}
        placeholder={placeholder}
        aria-label={label}
      />
    </label>
  );
}

export function AdminPagination({
  page,
  pageSize,
  count,
  href,
}: {
  page: number;
  pageSize: number;
  count: number;
  href: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const first = count ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, count);
  return (
    <nav className={styles.pagination} aria-label="Results pages">
      <span>
        Showing {first.toLocaleString()}–{last.toLocaleString()} of{" "}
        {count.toLocaleString()}
      </span>
      <div className={styles.paginationControls}>
        {page > 1 ? (
          <Link href={href(page - 1) as Route} aria-label="Previous page">
            <ChevronLeft size={16} />
            <span>Previous</span>
          </Link>
        ) : (
          <span
            className={styles.paginationDisabled}
            aria-label="Previous page unavailable"
          >
            <ChevronLeft size={16} />
            <span>Previous</span>
          </span>
        )}
        <strong>
          Page {page} of {pages}
        </strong>
        {page < pages ? (
          <Link href={href(page + 1) as Route} aria-label="Next page">
            <span>Next</span>
            <ChevronRight size={16} />
          </Link>
        ) : (
          <span
            className={styles.paginationDisabled}
            aria-label="Next page unavailable"
          >
            <span>Next</span>
            <ChevronRight size={16} />
          </span>
        )}
      </div>
    </nav>
  );
}

export function AdminCompactPager({
  page,
  pageSize,
  count,
  href,
  label,
}: {
  page: number;
  pageSize: number;
  count: number;
  href: (page: number) => string;
  label: string;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (count <= pageSize) return null;
  return (
    <nav className={styles.compactPager} aria-label={`${label} pages`}>
      {page > 1 ? (
        <Link
          href={href(page - 1) as Route}
          aria-label={`Previous ${label} page`}
          title="Previous page"
        >
          <ChevronLeft size={17} aria-hidden="true" />
        </Link>
      ) : (
        <span className={styles.compactPagerDisabled} aria-hidden="true">
          <ChevronLeft size={17} />
        </span>
      )}
      {page < pages ? (
        <Link
          href={href(page + 1) as Route}
          aria-label={`Next ${label} page`}
          title="Next page"
        >
          <ChevronRight size={17} aria-hidden="true" />
        </Link>
      ) : (
        <span className={styles.compactPagerDisabled} aria-hidden="true">
          <ChevronRight size={17} />
        </span>
      )}
    </nav>
  );
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
