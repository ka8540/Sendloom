import type { Route } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AUDIT_CATEGORIES, AUDIT_SEVERITIES } from "@/lib/audit";
import { requireAdminUser } from "@/lib/auth";
import {
  AdminEmptyState,
  AdminMetricStrip,
  AdminPagination,
  AdminPageHeader,
  AdminSearchInput,
  AdminShell,
  AdminStatusBadge,
  AdminTable,
  adminUiStyles as styles,
} from "@/components/admin-v2/admin-ui";
import { formatAdminInstant } from "@/components/admin-v2/format";
import { normalizeAdminPage } from "@/services/admin-v2/pagination";

const PAGE_SIZE = 25;

function dateInput(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : "";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    severity?: string;
    action?: string;
    user?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requireAdminUser();
  const p = await searchParams;
  const q = (p.q || "").trim().slice(0, 120);
  const user = (p.user || "").trim().slice(0, 120);
  const action = (p.action || "").trim().slice(0, 120);
  const category = AUDIT_CATEGORIES.some((value) => value === p.category)
    ? p.category!
    : "";
  const severity = AUDIT_SEVERITIES.some((value) => value === p.severity)
    ? p.severity!
    : "";
  const from = dateInput(p.from);
  const to = dateInput(p.to);
  const requestedPage = Math.max(1, Math.min(10000, Number(p.page) || 1));
  const dayAgo = new Date(Date.now() - 86_400_000);
  const conditions: Prisma.AuditLogWhereInput[] = [];
  if (q)
    conditions.push({
      OR: [
        { action: { contains: q, mode: "insensitive" } },
        { actorEmail: { contains: q, mode: "insensitive" } },
        { message: { contains: q, mode: "insensitive" } },
      ],
    });
  if (user)
    conditions.push({
      OR: [
        { actorUserId: user },
        { actorEmail: { contains: user, mode: "insensitive" } },
      ],
    });
  const where: Prisma.AuditLogWhereInput = {
    ...(category ? { category } : {}),
    ...(severity ? { severity } : {}),
    ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
            ...(to
              ? {
                  lt: new Date(
                    new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000,
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(conditions.length ? { AND: conditions } : {}),
  };
  const [count, dayCount, adminActions, securityEvents] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.auditLog.count({
      where: { category: "ADMIN", createdAt: { gte: dayAgo } },
    }),
    prisma.auditLog.count({
      where: { category: "SECURITY", createdAt: { gte: dayAgo } },
    }),
  ]);
  const page = normalizeAdminPage(requestedPage, count, PAGE_SIZE);
  const events = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      actorUserId: true,
      actorEmail: true,
      action: true,
      category: true,
      severity: true,
      message: true,
      createdAt: true,
    },
  });
  const href = (n: number) => {
    const u = new URLSearchParams();
    for (const [key, value] of Object.entries({
      q,
      user,
      action,
      category,
      severity,
      from,
      to,
    }))
      if (value) u.set(key, value);
    u.set("page", String(n));
    return `/admin/audit?${u}` as Route;
  };
  return (
    <AdminShell>
      <AdminPageHeader
        title="Audit & Security"
        description="Review administrative, authentication, and security-sensitive events."
      />
      <AdminMetricStrip
        items={[
          { label: "Events · 24h", value: dayCount },
          { label: "Admin actions · 24h", value: adminActions },
          { label: "Security events · 24h", value: securityEvents },
          {
            label:
              q || user || action || category || severity || from || to
                ? "Matching events"
                : "Total events",
            value: count,
          },
        ]}
      />
      <form className={styles.section} action="/admin/audit" method="get">
        <div className={styles.controlBar}>
          <AdminSearchInput
            value={q}
            placeholder="Search events"
            label="Search audit events"
          />
          <button className="button secondary" type="submit">
            Search
          </button>
          <span className={styles.muted}>{count.toLocaleString()} events</span>
        </div>
        <details
          className={styles.filterPanel}
          open={Boolean(user || action || category || severity || from || to)}
        >
          <summary>
            Filters{" "}
            {user || action || category || severity || from || to
              ? "· Active"
              : ""}
          </summary>
          <div className={styles.filterGrid}>
            <label>
              User{" "}
              <input
                className={styles.field}
                type="search"
                name="user"
                defaultValue={user}
                placeholder="ID or email"
              />
            </label>
            <label>
              Action{" "}
              <input
                className={styles.field}
                type="search"
                name="action"
                defaultValue={action}
                placeholder="Event type"
              />
            </label>
            <label>
              Category{" "}
              <select
                className={styles.field}
                name="category"
                defaultValue={category}
              >
                <option value="">All categories</option>
                {AUDIT_CATEGORIES.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Severity{" "}
              <select
                className={styles.field}
                name="severity"
                defaultValue={severity}
              >
                <option value="">All severities</option>
                {AUDIT_SEVERITIES.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From{" "}
              <input
                className={styles.field}
                type="date"
                name="from"
                defaultValue={from}
              />
            </label>
            <label>
              To{" "}
              <input
                className={styles.field}
                type="date"
                name="to"
                defaultValue={to}
              />
            </label>
          </div>
          <div className={styles.filterActions}>
            <button className="button secondary" type="submit">
              Apply filters
            </button>
            <Link href="/admin/audit">Clear filters</Link>
          </div>
        </details>
      </form>
      {(q || user || action || category || severity || from || to) && (
        <div className={styles.filterChips}>
          {Object.entries({
            Search: q,
            User: user,
            Action: action,
            Category: category,
            Severity: severity,
            From: from,
            To: to,
          })
            .filter(([, value]) => value)
            .map(([key, value]) => (
              <span key={key}>
                {key}: {value}
              </span>
            ))}
        </div>
      )}
      {events.length ? (
        <AdminTable
          headings={["Event", "Actor", "Category", "Severity", "When"]}
        >
          {events.map((event) => (
            <tr key={event.id}>
              <td>
                <details className={styles.eventDisclosure}>
                  <summary>{event.message || event.action}</summary>
                  <dl>
                    <dt>Action</dt>
                    <dd>{event.action}</dd>
                    <dt>Event ID</dt>
                    <dd>{event.id}</dd>
                    <dt>Recorded</dt>
                    <dd>{formatAdminInstant(event.createdAt)}</dd>
                  </dl>
                </details>
                <div className={styles.muted}>{event.action}</div>
              </td>
              <td>
                {event.actorUserId ? (
                  <Link href={`/admin/users/${event.actorUserId}?tab=activity`}>
                    {event.actorEmail}
                  </Link>
                ) : (
                  event.actorEmail
                )}
              </td>
              <td>{event.category}</td>
              <td>
                <AdminStatusBadge
                  status={event.severity}
                  tone={
                    event.severity === "SECURITY" || event.severity === "ERROR"
                      ? "danger"
                      : event.severity === "WARNING"
                        ? "warning"
                        : "neutral"
                  }
                />
              </td>
              <td title={event.createdAt.toISOString()}>
                {formatAdminInstant(event.createdAt)}
              </td>
            </tr>
          ))}
        </AdminTable>
      ) : (
        <AdminEmptyState>No audit events match these filters.</AdminEmptyState>
      )}
      <AdminPagination
        page={page}
        pageSize={PAGE_SIZE}
        count={count}
        href={href}
      />
    </AdminShell>
  );
}
