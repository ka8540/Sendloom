import type { ReactNode } from "react";
import { AdminPageHeader, AdminShell } from "@/components/admin-v2/admin-ui";
import { AdminWorkspaceTabs } from "@/components/admin-v2/workspace-tabs";
import { requireAdminUser } from "@/lib/auth";
export default async function OperationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAdminUser();
  return (
    <AdminShell>
      <AdminPageHeader
        title="Operations"
        description="Infrastructure and delivery systems in one operational workspace."
      />
      <AdminWorkspaceTabs
        items={[
          { label: "Platform", href: "/admin/operations" },
          { label: "Sending", href: "/admin/operations/sending" },
          { label: "Discover", href: "/admin/operations/discover" },
          { label: "Incidents", href: "/admin/operations/incidents" },
        ]}
      />
      {children}
    </AdminShell>
  );
}
