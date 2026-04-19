import { HunterDashboard } from "@/components/hunter-dashboard";
import { requireOperatorUser } from "@/lib/auth";
import { listHunterDomainSearchesForUser } from "@/services/hunter-domain-searches";
import { getHunterKeyStatusForUser } from "@/services/hunter-keys";

export default async function FinderPage() {
  const user = await requireOperatorUser();
  const [hunterKeyStatus, initialDomainSearchHistory] = await Promise.all([
    getHunterKeyStatusForUser(user.id),
    listHunterDomainSearchesForUser(user.id)
  ]);

  return <HunterDashboard initialKeyStatus={hunterKeyStatus} initialDomainSearchHistory={initialDomainSearchHistory} />;
}
