import { HunterDashboard } from "@/components/hunter-dashboard";
import { requireOperatorUser } from "@/lib/auth";
import { getHunterKeyStatusForUser } from "@/services/hunter-keys";

export default async function FinderPage() {
  const user = await requireOperatorUser();
  const hunterKeyStatus = await getHunterKeyStatusForUser(user.id);

  return <HunterDashboard initialKeyStatus={hunterKeyStatus} />;
}
