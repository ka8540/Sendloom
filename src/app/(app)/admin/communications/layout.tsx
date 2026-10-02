import type { ReactNode } from "react";
import { requireAdminUser } from "@/lib/auth";
import { AdminShell } from "@/components/admin-v2/admin-ui";
import { AdminWorkspaceTabs } from "@/components/admin-v2/workspace-tabs";
export default async function CommunicationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAdminUser();
  return (
    <AdminShell>
      <AdminWorkspaceTabs
        items={[
          { label: "Overview", href: "/admin/communications" },
          {
            label: "Product Updates",
            href: "/admin/communications/product-updates",
          },
          {
            label: "System Notices",
            href: "/admin/communications/system-notices",
          },
          { label: "Legal Releases", href: "/admin/communications/legal" },
        ]}
      />
      {children}
    </AdminShell>
  );
}
