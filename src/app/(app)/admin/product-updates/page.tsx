import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/auth";
export default async function UpdatesRedirect() {
  await requireAdminUser();
  redirect("/admin/communications/product-updates");
}
