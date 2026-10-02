import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/auth";
export default async function ActivityRedirect({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string }>;
}) {
  await requireAdminUser();
  const p = await searchParams;
  redirect(
    p.userId
      ? `/admin/users/${encodeURIComponent(p.userId)}?tab=activity`
      : "/admin/audit",
  );
}
