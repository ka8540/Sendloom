import { ProductUpdatesWorkspace } from "@/app/(app)/admin/product-updates/product-updates-workspace";
export default async function ProductUpdatesPage({ searchParams }: { searchParams: Promise<{ page?: string; activePage?: string }> }) {
  const params = await searchParams;
  return <ProductUpdatesWorkspace initialPage={Number(params.page) || 1} initialActivePage={Number(params.activePage) || 1} />;
}
