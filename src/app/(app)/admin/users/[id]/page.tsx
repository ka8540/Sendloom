import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminUser } from "@/lib/auth";
import { getUserWorkspace } from "@/services/admin-v2/users";
import { AdminUserControls } from "@/components/admin-user-controls";
import { UserRestrictionControls } from "@/components/admin-v2/user-restriction-controls";
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
  const restricted = Boolean(
    user.restrictedAt ||
    user.apiAccessDisabled ||
    user.importsWriteDisabled ||
    user.templatesWriteDisabled ||
    user.launchesDisabled ||
    user.aiEnhancementsDisabled,
  );
  return (
    <AdminShell>
      <Link href="/admin/users">← Users</Link>
      <AdminPageHeader
        title={user.email}
        description={`Joined ${user.createdAt.toLocaleDateString()} · ${user.isAdmin ? "Admin" : "User"}`}
        actions={
          <AdminStatusBadge
            status={
              restricted
                ? "Restricted"
                : user.eligibilityBlockedAt
                  ? "Needs attention"
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
      <AdminTabs
        active={`/admin/users/${id}?tab=${tab}`}
        items={["overview", "usage", "access", "activity"].map((value) => ({
          label: value[0].toUpperCase() + value.slice(1),
          href: `/admin/users/${id}?tab=${value}`,
        }))}
      />
      {tab === "overview" && (
        <>
          <AdminMetricStrip
            items={[
              { label: "Senders", value: user._count.senderProfiles },
              { label: "Sequences", value: user._count.campaigns },
              { label: "Imports", value: user._count.imports },
              { label: "Templates", value: user._count.templates },
            ]}
          />
          <AdminSection title="Account overview">
            <AdminTable headings={["Field", "Value"]}>
              <tr>
                <td>Last login</td>
                <td>{user.lastLoginAt?.toLocaleString() || "Not tracked"}</td>
              </tr>
              <tr>
                <td>Last seen</td>
                <td>{user.lastSeenAt?.toLocaleString() || "Not tracked"}</td>
              </tr>
              <tr>
                <td>Eligibility</td>
                <td>
                  {user.eligibilityBlockedAt
                    ? "Blocked"
                    : user.adultVerifiedAt &&
                        user.termsAcceptedAt &&
                        user.privacyAcceptedAt &&
                        user.antiAbuseAcceptedAt
                      ? "Completed"
                      : "Incomplete"}
                </td>
              </tr>
              <tr>
                <td>Account restriction</td>
                <td>
                  {user.restrictedAt ? "Restricted" : "No account restriction"}
                </td>
              </tr>
            </AdminTable>
          </AdminSection>
        </>
      )}
      {tab === "usage" && (
        <>
          <AdminMetricStrip
            items={[
              { label: "Confirmed sends", value: user.confirmedSends },
              { label: "Matched replies", value: user.replies },
              {
                label: "Discover searches",
                value: user._count.prospectSearches,
              },
              { label: "Sequences", value: user._count.campaigns },
            ]}
          />
          <AdminSection title="Workspace assets">
            <AdminTable headings={["Asset", "Count"]}>
              <tr>
                <td>Imports</td>
                <td>{user._count.imports}</td>
              </tr>
              <tr>
                <td>Templates</td>
                <td>{user._count.templates}</td>
              </tr>
              <tr>
                <td>Sender profiles</td>
                <td>{user._count.senderProfiles}</td>
              </tr>
            </AdminTable>
          </AdminSection>
        </>
      )}
      {tab === "access" && (
        <>
          <AdminSection
            title="Access controls"
            description="Changes are enforced by the existing admin API and audited"
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
          title="Recent account activity"
          description="Audit events are sanitized and include legacy email-only rows"
        >
          {user.events.length ? (
            <AdminTable headings={["Event", "Category", "Severity", "When"]}>
              {user.events.map((event) => (
                <tr key={event.id}>
                  <td>{event.message || event.action}</td>
                  <td>{event.category}</td>
                  <td>{event.severity}</td>
                  <td>{new Date(event.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </AdminTable>
          ) : (
            <p>No account events recorded.</p>
          )}
        </AdminSection>
      )}
    </AdminShell>
  );
}
