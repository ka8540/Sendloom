import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminUser } from "@/lib/auth";
import { getUserWorkspace, getUserUsageTrend } from "@/services/admin-v2/users";
import { AdminUserControls } from "@/components/admin-user-controls";
import { UserRestrictionControls } from "@/components/admin-v2/user-restriction-controls";
import { AdminTimeChart } from "@/components/admin-v2/admin-charts";
import {
  formatAdminDate,
  formatAdminInstant,
  formatAdminRelative,
} from "@/components/admin-v2/format";
import {
  AdminMetricStrip,
  AdminPageHeader,
  AdminSection,
  AdminShell,
  AdminStatusBadge,
  AdminTable,
  AdminTabs,
  adminUiStyles as styles,
} from "@/components/admin-v2/admin-ui";

export default async function UserDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const admin = await requireAdminUser();
  const { id } = await params;
  const user = await getUserWorkspace(id);
  if (!user) notFound();
  const requested = (await searchParams).tab;
  const tab = ["overview", "usage", "access", "activity"].includes(
    requested || "",
  )
    ? requested!
    : "overview";
  const usageTrend = tab === "usage" ? await getUserUsageTrend(id) : null;
  const restricted = Boolean(
    user.restrictedAt ||
    user.apiAccessDisabled ||
    user.importsWriteDisabled ||
    user.templatesWriteDisabled ||
    user.launchesDisabled ||
    user.aiEnhancementsDisabled,
  );
  const eligible = Boolean(
    user.adultVerifiedAt &&
    user.termsAcceptedAt &&
    user.privacyAcceptedAt &&
    user.antiAbuseAcceptedAt,
  );
  return (
    <AdminShell>
      <Link href="/admin/users">← Users</Link>
      <AdminPageHeader
        title={user.email}
        description={`Joined ${formatAdminDate(user.createdAt)} · Last active ${formatAdminRelative(user.lastSeenAt)} · ${user.isAdmin ? "Admin account" : "Product user"}`}
        actions={
          <AdminStatusBadge
            status={
              restricted
                ? "Restricted"
                : user.eligibilityBlockedAt
                  ? "Needs attention"
                  : user.isAdmin
                    ? "Admin"
                    : "Normal"
            }
            tone={
              restricted
                ? "danger"
                : user.eligibilityBlockedAt
                  ? "warning"
                  : "healthy"
            }
          />
        }
      />
      <AdminMetricStrip
        items={[
          { label: "Confirmed sends", value: user.confirmedSends },
          { label: "Sequences", value: user._count.campaigns },
          { label: "Discover searches", value: user._count.prospectSearches },
          { label: "Imports", value: user._count.imports },
          { label: "Templates", value: user._count.templates },
          { label: "Connected senders", value: user.connectedSenders },
        ]}
      />
      <AdminTabs
        active={`/admin/users/${id}?tab=${tab}`}
        items={["overview", "usage", "access", "activity"].map((value) => ({
          label: value[0].toUpperCase() + value.slice(1),
          href: `/admin/users/${id}?tab=${value}`,
        }))}
      />
      {tab === "overview" && (
        <>
          <div className={styles.twoColumn}>
            <AdminSection
              title="Account"
              description="Identity and eligibility"
            >
              <div className={styles.panel}>
                <dl className={styles.dataList}>
                  <div className={styles.definitionRow}>
                    <dt>Joined</dt>
                    <dd>{formatAdminDate(user.createdAt)}</dd>
                  </div>
                  <div className={styles.definitionRow}>
                    <dt>Last login</dt>
                    <dd>{formatAdminInstant(user.lastLoginAt)}</dd>
                  </div>
                  <div className={styles.definitionRow}>
                    <dt>Last active</dt>
                    <dd>{formatAdminInstant(user.lastSeenAt)}</dd>
                  </div>
                  <div className={styles.definitionRow}>
                    <dt>Eligibility</dt>
                    <dd>
                      {user.eligibilityBlockedAt
                        ? "Blocked"
                        : eligible
                          ? "Completed"
                          : "Incomplete"}
                    </dd>
                  </div>
                  <div className={styles.definitionRow}>
                    <dt>Account state</dt>
                    <dd>{restricted ? "Restricted" : "Normal"}</dd>
                  </div>
                </dl>
              </div>
            </AdminSection>
            <AdminSection
              title="Sending"
              description="Sender and sequence state"
            >
              <div className={styles.panel}>
                <dl className={styles.dataList}>
                  <div className={styles.definitionRow}>
                    <dt>Connected senders</dt>
                    <dd>{user.connectedSenders.toLocaleString()}</dd>
                  </div>
                  <div className={styles.definitionRow}>
                    <dt>Running sequences</dt>
                    <dd>{user.activeRuns.toLocaleString()}</dd>
                  </div>
                  <div className={styles.definitionRow}>
                    <dt>Paused runs</dt>
                    <dd>{user.pausedRuns.toLocaleString()}</dd>
                  </div>
                  <div className={styles.definitionRow}>
                    <dt>Confirmed sends</dt>
                    <dd>{user.confirmedSends.toLocaleString()}</dd>
                  </div>
                  <div className={styles.definitionRow}>
                    <dt>Matched replies</dt>
                    <dd>{user.replies.toLocaleString()}</dd>
                  </div>
                </dl>
              </div>
            </AdminSection>
          </div>
          <AdminSection
            title="Recent account activity"
            action={
              <Link href={`/admin/users/${id}?tab=activity`}>
                View activity →
              </Link>
            }
          >
            {user.events.length ? (
              <ul className={`${styles.panel} ${styles.list}`}>
                {user.events.slice(0, 5).map((event) => (
                  <li className={styles.activityRow} key={event.id}>
                    <span>{event.message || event.action}</span>
                    <small>{formatAdminRelative(event.createdAt)}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.compactEmpty}>No account events recorded.</p>
            )}
          </AdminSection>
        </>
      )}
      {tab === "usage" && (
        <>
          <AdminSection
            title="30-day activity"
            description="Confirmed sends, sequence runs, and Discover searches by UTC day"
          >
            <div className={styles.panel}>
              <AdminTimeChart
                data={usageTrend ?? []}
                series={[
                  {
                    key: "sends",
                    name: "Confirmed sends",
                    color: "var(--analysis-green)",
                  },
                  {
                    key: "runs",
                    name: "Sequence runs",
                    color: "var(--analysis-blue)",
                  },
                  {
                    key: "searches",
                    name: "Discover searches",
                    color: "var(--analysis-purple)",
                  },
                ]}
              />
            </div>
          </AdminSection>
          <AdminSection
            title="Feature footprint"
            description="Persisted assets and usage totals"
          >
            <div className={styles.panel}>
              <dl className={styles.dataList}>
                <div className={styles.definitionRow}>
                  <dt>Discover searches</dt>
                  <dd>{user._count.prospectSearches.toLocaleString()}</dd>
                </div>
                <div className={styles.definitionRow}>
                  <dt>Imports</dt>
                  <dd>{user._count.imports.toLocaleString()}</dd>
                </div>
                <div className={styles.definitionRow}>
                  <dt>Templates</dt>
                  <dd>{user._count.templates.toLocaleString()}</dd>
                </div>
                <div className={styles.definitionRow}>
                  <dt>Sequences</dt>
                  <dd>{user._count.campaigns.toLocaleString()}</dd>
                </div>
                <div className={styles.definitionRow}>
                  <dt>Sender profiles</dt>
                  <dd>{user._count.senderProfiles.toLocaleString()}</dd>
                </div>
              </dl>
            </div>
          </AdminSection>
        </>
      )}
      {tab === "access" && (
        <>
          <AdminSection
            title="Access controls"
            description="Changes use the existing audited admin API"
          >
            <div className={styles.panel}>
              <AdminUserControls
                userId={id}
                email={user.email}
                isLoggedIn={Boolean(
                  user.sessionExpiresAt && user.sessionExpiresAt > new Date(),
                )}
                isSelfProtected={id === admin.id}
                isAdminProtected={user.isAdmin}
                initialControls={{
                  apiAccessDisabled: user.apiAccessDisabled,
                  importsWriteDisabled: user.importsWriteDisabled,
                  templatesWriteDisabled: user.templatesWriteDisabled,
                  launchesDisabled: user.launchesDisabled,
                  aiEnhancementsDisabled: user.aiEnhancementsDisabled,
                }}
              />
            </div>
          </AdminSection>
          <AdminSection title="Account restriction">
            <UserRestrictionControls
              userId={id}
              restricted={Boolean(user.restrictedAt)}
              protectedAccount={user.isAdmin || id === admin.id}
            />
          </AdminSection>
        </>
      )}
      {tab === "activity" && (
        <AdminSection
          title="Account activity"
          description="Latest 20 sanitized events, including legacy email-only rows"
          action={
            <Link href={`/admin/audit?user=${encodeURIComponent(user.email)}`}>
              Full audit history →
            </Link>
          }
        >
          {user.events.length ? (
            <AdminTable headings={["Event", "Category", "Severity", "When"]}>
              {user.events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <strong>{event.message || event.action}</strong>
                    <div className={styles.muted}>{event.action}</div>
                  </td>
                  <td>{event.category}</td>
                  <td>
                    <AdminStatusBadge
                      status={event.severity}
                      tone={
                        event.severity === "ERROR" ||
                        event.severity === "SECURITY"
                          ? "danger"
                          : event.severity === "WARNING"
                            ? "warning"
                            : "neutral"
                      }
                    />
                  </td>
                  <td>{formatAdminInstant(event.createdAt)}</td>
                </tr>
              ))}
            </AdminTable>
          ) : (
            <p className={styles.compactEmpty}>No account events recorded.</p>
          )}
        </AdminSection>
      )}
    </AdminShell>
  );
}
