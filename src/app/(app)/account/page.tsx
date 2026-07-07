import { AccountDashboard } from "@/components/account/account-dashboard";
import { requireOperatorUser } from "@/lib/auth";
import { getAccountOverview } from "@/services/account";

// Return here after the Gmail OAuth kickoff so a newly connected sender shows
// up on the account page (the connect callback appends ?gmail=connected).
const CONNECT_GMAIL_HREF = `/api/auth/google/connect?next=${encodeURIComponent("/account")}`;

export default async function AccountPage() {
  const user = await requireOperatorUser();
  const overview = await getAccountOverview(user.id, user);

  return <AccountDashboard initialData={overview} connectGmailHref={CONNECT_GMAIL_HREF} />;
}
