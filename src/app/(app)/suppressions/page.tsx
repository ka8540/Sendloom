import { SuppressionsWorkspace } from "@/components/suppressions/suppressions-workspace";
import { requireOperatorUser } from "@/lib/auth";
import { listSuppressions } from "@/services/suppressions";

export default async function SuppressionsPage() {
  const user = await requireOperatorUser();
  const suppressions = await listSuppressions(user.id);
  const initialSuppressions = suppressions.map((entry) => ({
    ...entry,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString()
  }));

  return <SuppressionsWorkspace initialSuppressions={initialSuppressions} />;
}
