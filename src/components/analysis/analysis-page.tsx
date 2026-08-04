import type { AnalysisPage } from "@/lib/analysis";
import { requireUser } from "@/lib/auth";

import { AnalysisWorkspace } from "@/components/analysis/analysis-workspace";

export async function AnalysisPage({ page }: { page: AnalysisPage }) {
  await requireUser();
  return <AnalysisWorkspace page={page} />;
}
