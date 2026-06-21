import { ProspectsListView } from "@/components/prospects/prospects-list-view";
import { requireUser } from "@/lib/auth";

// Auth uses cookies(), so this route is always dynamic and never statically
// prerendered. We read the feature flag from process.env directly (not the
// parsed env proxy) so build-time page-data collection never triggers a full
// env parse — see the prospect-graph backend notes on env access scope. The
// client also handles the disabled state at runtime via the 404 from
// /api/graphql, so this is a fast first-paint hint, not the sole guard.
export const dynamic = "force-dynamic";

export default async function ProspectsPage() {
  await requireUser();
  const featureEnabled = (process.env.PROSPECT_GRAPH_ENABLED ?? "").trim().toLowerCase() === "true";

  return <ProspectsListView featureEnabled={featureEnabled} />;
}
