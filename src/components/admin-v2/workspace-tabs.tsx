"use client";
import { usePathname } from "next/navigation";
import { AdminTabs } from "./admin-ui";
export function AdminWorkspaceTabs({
  items,
}: {
  items: Array<{ label: string; href: string }>;
}) {
  const path = usePathname();
  const active =
    items
      .slice()
      .reverse()
      .find((item) => path === item.href || path.startsWith(item.href + "/"))
      ?.href || items[0].href;
  return <AdminTabs items={items} active={active} />;
}
