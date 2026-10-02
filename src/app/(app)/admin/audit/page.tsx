import type { Route } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AUDIT_CATEGORIES, AUDIT_SEVERITIES } from "@/lib/audit";
import { requireAdminUser } from "@/lib/auth";
import {
  AdminEmptyState,
  AdminMetricStrip,
  AdminPageHeader,
  AdminShell,
  AdminStatusBadge,
  AdminTable,
  adminUiStyles as styles,
} from "@/components/admin-v2/admin-ui";

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
  const page = Math.max(1, Math.min(10000, Number(p.page) || 1));
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
  const [count, events, dayCount, adminActions, securityEvents] =
    await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 25,
        take: 25,
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
      }),
      prisma.auditLog.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.auditLog.count({
        where: { category: "ADMIN", createdAt: { gte: dayAgo } },
      }),
      prisma.auditLog.count({
        where: { category: "SECURITY", createdAt: { gte: dayAgo } },
      }),
    ]);
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
        description="Security and administrative events, with sanitized details and legacy actor matching."
      />
      <AdminMetricStrip
        items={[
          { label: "Events · 24h", value: dayCount },
          { label: "Admin actions · 24h", value: adminActions },
          { label: "Security events · 24h", value: securityEvents },
          { label: "Matching events", value: count },
        ]}
      />
      <form className={styles.toolbar} action="/admin/audit" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search events"
          aria-label="Search audit events"
        />
        <input
          type="search"
          name="user"
          defaultValue={user}
          placeholder="User ID or email"
          aria-label="Filter by user"
        />
        <input
          type="search"
          name="action"
          defaultValue={action}
          placeholder="Action"
          aria-label="Filter by action"
        />
        <select
          name="category"
          defaultValue={category}
          aria-label="Audit category"
        >
          <option value="">All categories</option>
          {AUDIT_CATEGORIES.map((value) => (
            <option value={value} key={value}>
              {value}
            </option>
          ))}
        </select>
        <select name="severity" defaultValue={severity} aria-label="Severity">
          <option value="">All severities</option>
          {AUDIT_SEVERITIES.map((value) => (
            <option value={value} key={value}>
              {value}
            </option>
          ))}
        </select>
        <label>
          From <input type="date" name="from" defaultValue={from} />
        </label>
        <label>
          To <input type="date" name="to" defaultValue={to} />
        </label>
        <button className="button secondary" type="submit">
          Filter
        </button>
      </form>
      {events.length ? (
        <AdminTable
          headings={["Event", "Actor", "Category", "Severity", "When"]}
        >
          {events.map((event) => (
            <tr key={event.id}>
              <td>
                <strong>{event.message || event.action}</strong>
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
              <td>{event.createdAt.toLocaleString()}</td>
            </tr>
          ))}
        </AdminTable>
      ) : (
        <AdminEmptyState>No audit events match these filters.</AdminEmptyState>
      )}
      <div className={styles.toolbar}>
        <span>
          Page {page} of {Math.max(1, Math.ceil(count / 25))}
        </span>
        {page > 1 && <Link href={href(page - 1)}>← Previous</Link>}
        {page * 25 < count && <Link href={href(page + 1)}>Next →</Link>}
      </div>
    </AdminShell>
  );
}
