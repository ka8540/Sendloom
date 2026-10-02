import { prisma } from "@/lib/db";
import { normalizeAdminPage } from "@/services/admin-v2/pagination";
import {
  AdminEmptyState,
  AdminMetricStrip,
  AdminPagination,
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
  AdminTable,
} from "@/components/admin-v2/admin-ui";
import { formatAdminDate } from "@/components/admin-v2/format";
export default async function LegalReleasesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const requestedPage = Number((await searchParams).page) || 1;
  const [count, processing, completed, failed] = await Promise.all([
    prisma.legalPolicyRelease.count(),
    prisma.legalPolicyRelease.count({ where: { status: "PROCESSING" } }),
    prisma.legalPolicyRelease.count({ where: { status: "COMPLETED" } }),
    prisma.legalPolicyReleaseRecipient.count({
      where: { status: "FAILED_PERMANENT" },
    }),
  ]);
  const page = normalizeAdminPage(requestedPage, count, 20);
  const releases = await prisma.legalPolicyRelease.findMany({
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * 20,
    take: 20,
    select: {
      id: true,
      releaseGroup: true,
      status: true,
      createdAt: true,
      completedAt: true,
      notices: { select: { policy: true, version: true } },
      _count: { select: { recipients: true } },
    },
  });
  return (
    <>
      <AdminPageHeader
        title="Legal Releases"
        description="Monitor policy release delivery without changing legal text."
      />
      <AdminMetricStrip
        items={[
          { label: "Releases", value: count },
          { label: "Processing", value: processing },
          { label: "Completed", value: completed },
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
                <td>{formatAdminDate(release.createdAt)}</td>
              </tr>
            ))}
          </AdminTable>
        ) : (
          <AdminEmptyState>No grouped legal releases recorded.</AdminEmptyState>
        )}
      </AdminSection>
      <AdminPagination
        page={page}
        pageSize={20}
        count={count}
        href={(next) => `/admin/communications/legal?page=${next}`}
      />
    </>
  );
}
