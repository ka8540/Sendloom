import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/auth";
export default async function NoticesRedirect() {
  await requireAdminUser();
  redirect("/admin/communications/system-notices");
}
