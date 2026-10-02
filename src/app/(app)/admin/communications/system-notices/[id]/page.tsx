import Link from "next/link";
import { notFound } from "next/navigation";
import { getSystemNotice } from "@/services/system-notices";
import {
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
  AdminTable,
} from "@/components/admin-v2/admin-ui";
export default async function SystemNoticeDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getSystemNotice(id);
  if (!item) notFound();
  return (
    <>
      <AdminPageHeader
        title="System Notice"
        description="Delivery details and status"
      />
      <Link href="/admin/communications/system-notices">← System Notices</Link>
      <AdminSection title={item.title} description={item.subject}>
        <AdminStatusBadge
          status={item.status}
          tone={
            item.status === "FAILED"
              ? "danger"
              : item.status === "COMPLETED"
                ? "healthy"
                : "warning"
          }
        />
        <p>{item.message}</p>
        <AdminTable headings={["Delivery", "Count"]}>
          <tr>
            <td>Recipients</td>
            <td>{item.delivery.recipientTotal}</td>
          </tr>
          <tr>
            <td>Sent</td>
            <td>{item.delivery.sent}</td>
          </tr>
          <tr>
            <td>Remaining</td>
            <td>{item.delivery.remaining}</td>
          </tr>
          <tr>
            <td>Permanent failures</td>
            <td>{item.delivery.permanentFailures}</td>
          </tr>
        </AdminTable>
      </AdminSection>
    </>
  );
}
