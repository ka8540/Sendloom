import { ProspectDetailView } from "@/components/prospects/prospect-detail-view";
import { requireUser } from "@/lib/auth";

// Dedicated Discover search detail page. Like the list page, auth uses cookies()
// so this route is always dynamic, and the feature flag is read from process.env
// directly to avoid a full env parse during build-time page-data collection. The
// detail view loads the user-owned search from the route id via /api/graphql; an
// unknown or non-owned id resolves to a safe not-found state on the client.
export const dynamic = "force-dynamic";

export default async function ProspectDetailPage({ params }: { params: Promise<{ searchId: string }> }) {
  await requireUser();
  const { searchId } = await params;
  const featureEnabled = (process.env.PROSPECT_GRAPH_ENABLED ?? "").trim().toLowerCase() === "true";

  return <ProspectDetailView searchId={searchId} featureEnabled={featureEnabled} />;
}
