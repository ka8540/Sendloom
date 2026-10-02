import { SystemNoticesWorkspace } from "@/app/(app)/admin/system-notices/system-notices-workspace";
export default async function SystemNoticesPage({ searchParams }: { searchParams: Promise<{ page?: string; activePage?: string }> }) {
  const params = await searchParams;
  return <SystemNoticesWorkspace initialPage={Number(params.page) || 1} initialActivePage={Number(params.activePage) || 1} />;
}
