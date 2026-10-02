import type { Route } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatAdminDate } from "@/components/admin-v2/format";
import {
  AdminEmptyState,
  AdminMetricStrip,
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
  AdminTable,
} from "@/components/admin-v2/admin-ui";

export default async function CommunicationsPage() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [
    notices,
    updates,
    noticeStates,
    updateStates,
    completedNotices,
    completedUpdates,
    noticeFailures,
    updateFailures,
  ] = await Promise.all([
    prisma.systemNotice.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, title: true, status: true, createdAt: true },
    }),
    prisma.productUpdateBroadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, headline: true, status: true, createdAt: true },
    }),
    prisma.systemNotice.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { status: { in: ["SCHEDULED", "SENDING", "FAILED"] } },
    }),
    prisma.productUpdateBroadcast.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { status: { in: ["SCHEDULED", "SENDING", "FAILED"] } },
    }),
    prisma.systemNotice.count({
      where: { status: "COMPLETED", completedAt: { gte: since } },
    }),
    prisma.productUpdateBroadcast.count({
      where: { status: "COMPLETED", completedAt: { gte: since } },
    }),
    prisma.systemNoticeRecipient.count({
      where: { status: "PERMANENT_FAILURE" },
    }),
    prisma.productUpdateBroadcastRecipient.count({
      where: { status: "PERMANENT_FAILURE" },
    }),
  ]);
  const stateCount = (status: string) =>
    (noticeStates.find((row) => row.status === status)?._count._all ?? 0) +
    (updateStates.find((row) => row.status === status)?._count._all ?? 0);
  const items = [
    ...notices.map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      createdAt: n.createdAt,
      href: `/admin/communications/system-notices/${n.id}`,
      kind: "System notice",
    })),
    ...updates.map((u) => ({
      id: u.id,
      title: u.headline,
      status: u.status,
      createdAt: u.createdAt,
      href: `/admin/communications/product-updates/${u.id}`,
      kind: "Product update",
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 12);
  return (
    <>
      <AdminPageHeader
        title="Communications"
        description="Track announcements, service notices, and legal delivery from one place."
      />
      <AdminMetricStrip
        items={[
          { label: "Scheduled", value: stateCount("SCHEDULED") },
          { label: "Delivering", value: stateCount("SENDING") },
          { label: "Sent · 30d", value: completedNotices + completedUpdates },
          {
            label: "Delivery issues",
            value: stateCount("FAILED") + noticeFailures + updateFailures,
            tone:
              stateCount("FAILED") + noticeFailures + updateFailures
                ? "warning"
                : undefined,
          },
        ]}
      />
      <AdminSection
        title="Recent communications"
        description="Product Updates and System Notices retain separate delivery systems"
        action={
          <>
            <Link
              className="button secondary"
              href="/admin/communications/product-updates"
            >
              New update
            </Link>{" "}
            <Link
              className="button secondary"
              href="/admin/communications/system-notices"
            >
              New notice
            </Link>
          </>
        }
      >
        {items.length ? (
          <AdminTable headings={["Communication", "Type", "State", "Created"]}>
            {items.map((item) => (
              <tr key={`${item.kind}-${item.id}`}>
                <td>
                  <Link href={item.href as Route}>{item.title}</Link>
                </td>
                <td>{item.kind}</td>
                <td>
                  <AdminStatusBadge
                    status={item.status}
                    tone={
                      item.status === "FAILED"
                        ? "danger"
                        : item.status === "COMPLETED"
                          ? "healthy"
                          : item.status === "SCHEDULED"
                            ? "warning"
                            : "neutral"
                    }
                  />
                </td>
                <td>{formatAdminDate(item.createdAt)}</td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <AdminEmptyState>
            No communications have been created.
          </AdminEmptyState>
        )}
      </AdminSection>
    </>
  );
}
