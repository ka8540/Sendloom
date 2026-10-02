import Link from "next/link";
import { requireAdminUser } from "@/lib/auth";
import { AdminUsersSearch } from "@/components/admin-v2/users-search";
import {
  listUsersWorkspace,
  normalizeUserStatus,
} from "@/services/admin-v2/users";
import {
  AdminEmptyState,
  AdminMetricStrip,
  AdminPagination,
  AdminPageHeader,
  AdminShell,
  AdminStatusBadge,
  AdminTable,
  AdminTabs,
  adminUiStyles as styles,
} from "@/components/admin-v2/admin-ui";
import {
  formatAdminDate,
  formatAdminInstant,
  formatAdminRelative,
} from "@/components/admin-v2/format";
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  await requireAdminUser();
  const params = await searchParams;
  const status = normalizeUserStatus(params.status);
  const q = (params.q || "").trim();
  const page = Number(params.page) || 1;
  const data = await listUsersWorkspace({ status, query: q, page });
  const href = (overrides: Record<string, string>) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (status !== "all") p.set("status", status);
    p.set("page", String(data.page));
    for (const [k, v] of Object.entries(overrides)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `/admin/users?${p}`;
  };
  return (
    <AdminShell>
      <AdminPageHeader
        title="Users"
        description="Find accounts, review usage, and manage access from each user workspace."
      />
      <AdminMetricStrip
        items={[
          {
            label: "Total accounts",
            value: data.summary.total,
            note: "Includes admins",
          },
          {
            label: "Active product users · 24h",
            value: data.summary.active,
            note: "Latest activity",
          },
          {
            label: "Needs attention",
            value: data.summary.attention,
            tone: data.summary.attention ? "warning" : undefined,
          },
          {
            label: "Restricted",
            value: data.summary.restricted,
            tone: data.summary.restricted ? "warning" : undefined,
          },
        ]}
      />
      <AdminTabs
        active={href({ status: status === "all" ? "" : status, page: "1" })}
        items={[
          { label: "All", value: "all" },
          { label: "Active", value: "active" },
          { label: "Needs attention", value: "attention" },
          { label: "Restricted", value: "restricted" },
        ].map((item) => ({
          label: item.label,
          href: href({
            status: item.value === "all" ? "" : item.value,
            page: "1",
          }),
        }))}
      />
      <div className={styles.usersToolbar}>
        <AdminUsersSearch query={q} status={status} />
        <span className={styles.usersCount} aria-live="polite">
          {data.count.toLocaleString()} {data.count === 1 ? "user" : "users"}
        </span>
      </div>
      {data.users.length ? (
        <AdminTable
          headings={[
            "User",
            "Status",
            "Last active",
            "Senders",
            "Sequences",
            "Discover",
            "Joined",
          ]}
        >
          {data.users.map((user) => {
            const restricted = Boolean(
              user.restrictedAt ||
              user.apiAccessDisabled ||
              user.importsWriteDisabled ||
              user.templatesWriteDisabled ||
              user.launchesDisabled ||
              user.aiEnhancementsDisabled,
            );
            return (
              <tr key={user.id} className={styles.clickableRow}>
                <td>
                  <Link href={`/admin/users/${user.id}`}>{user.email}</Link>
                </td>
                <td>
                  <AdminStatusBadge
                    status={
                      user.eligibilityBlockedAt
                        ? "Needs attention"
                        : restricted
                          ? "Restricted"
                          : user.isAdmin
                            ? "Admin"
                            : "Normal"
                    }
                    tone={
                      user.eligibilityBlockedAt
                        ? "warning"
                        : restricted
                          ? "danger"
                          : "neutral"
                    }
                  />
                </td>
                <td
                  title={
                    user.lastSeenAt
                      ? formatAdminInstant(user.lastSeenAt)
                      : undefined
                  }
                >
                  {formatAdminRelative(user.lastSeenAt)}
                </td>
                <td>{user._count.senderProfiles}</td>
                <td>{user._count.campaigns}</td>
                <td>{user._count.prospectSearches}</td>
                <td>{formatAdminDate(user.createdAt)}</td>
              </tr>
            );
          })}
        </AdminTable>
      ) : (
        <AdminEmptyState>No users match these filters.</AdminEmptyState>
      )}
      <AdminPagination
        page={data.page}
        pageSize={data.pageSize}
        count={data.count}
        href={(page) => href({ page: String(page) })}
      />
    </AdminShell>
  );
}
