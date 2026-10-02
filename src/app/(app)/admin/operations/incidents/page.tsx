import { AdminIncidentsWorkspace } from "@/app/(app)/admin/incidents/incidents-workspace";
import { AdminSection } from "@/components/admin-v2/admin-ui";
export default function IncidentsPage() {
  return (
    <AdminSection
      title="Incident reports"
      description="Reporters remain anonymous; severity and investigation history use the existing incident service."
    >
      <AdminIncidentsWorkspace />
    </AdminSection>
  );
}
