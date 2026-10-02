import { prisma } from "@/lib/db";
import {
  AdminEmptyState,
  AdminMetricStrip,
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
  AdminTable,
} from "@/components/admin-v2/admin-ui";
export default async function LegalReleasesPage() {
  const [releases, failed] = await Promise.all([
    prisma.legalPolicyRelease.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        releaseGroup: true,
        status: true,
        createdAt: true,
        completedAt: true,
        notices: { select: { policy: true, version: true } },
        _count: { select: { recipients: true } },
      },
    }),
    prisma.legalPolicyReleaseRecipient.count({
      where: { status: "FAILED_PERMANENT" },
    }),
  ]);
  return (
    <>
      <AdminPageHeader
        title="Legal Releases"
        description="Monitor policy release delivery without changing legal text."
      />
      <AdminMetricStrip
        items={[
          { label: "Releases", value: releases.length },
          {
            label: "Processing",
            value: releases.filter((r) => r.status === "PROCESSING").length,
          },
          {
            label: "Completed",
            value: releases.filter((r) => r.status === "COMPLETED").length,
          },
          {
            label: "Permanent failures",
            value: failed,
            tone: failed ? "warning" : undefined,
          },
        ]}
      />
      <AdminSection
        title="Legal releases"
        description="Read-only monitoring. Policy text is managed by the release process, not edited here."
      >
        {releases.length ? (
          <AdminTable
            headings={[
              "Release group",
              "Policies",
              "Status",
              "Recipients",
              "Created",
            ]}
          >
            {releases.map((release) => (
              <tr key={release.id}>
                <td>{release.releaseGroup}</td>
                <td>
                  {release.notices
                    .map((n) => `${n.policy} v${n.version}`)
                    .join(", ") || "—"}
                </td>
                <td>
                  <AdminStatusBadge
                    status={release.status}
                    tone={
                      release.status === "FAILED"
                        ? "danger"
                        : release.status === "COMPLETED"
                          ? "healthy"
                          : "warning"
                    }
                  />
                </td>
                <td>{release._count.recipients}</td>
                <td>{release.createdAt.toLocaleString()}</td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <AdminEmptyState>No grouped legal releases recorded.</AdminEmptyState>
        )}
      </AdminSection>
    </>
  );
}
