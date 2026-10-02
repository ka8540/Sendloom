import { AdminIncidentsWorkspace } from "@/app/(app)/admin/incidents/incidents-workspace";
import { AdminSection } from "@/components/admin-v2/admin-ui";
export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    category?: string;
    severity?: string;
    status?: string;
    range?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Number(params.page) || 1;
  return (
    <AdminSection
      title="Incident reports"
      description="Reporters remain anonymous; severity and investigation history use the existing incident service."
    >
      <AdminIncidentsWorkspace initialPage={page} initialFilters={params} />
    </AdminSection>
  );
}
