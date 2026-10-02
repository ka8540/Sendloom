import Link from "next/link";
import { requireAdminUser } from "@/lib/auth";
import { listDeletionRequests } from "@/services/account-deletion";
import { AdminEmptyState, AdminPagination, AdminPageHeader, AdminShell, AdminStatusBadge, AdminTable, adminUiStyles as styles } from "@/components/admin-v2/admin-ui";
import { formatAdminInstant } from "@/components/admin-v2/format";
import queueStyles from "./queue.module.css";

export default async function DeletionRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string; from?: string; to?: string; page?: string }> }) {
  await requireAdminUser();
  const params = await searchParams;
  const parseDate = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value) : undefined;
  const to = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? new Date(`${params.to}T23:59:59.999Z`) : parseDate(params.to);
  const data = await listDeletionRequests({ status: params.status, from: parseDate(params.from), to, page: Number(params.page) || 1 });
  const href = (page: number) => { const query = new URLSearchParams(); if (params.status) query.set("status", params.status); if (params.from) query.set("from", params.from); if (params.to) query.set("to", params.to); query.set("page", String(page)); return `/admin/users/deletion-requests?${query}`; };
  return <AdminShell>
    <AdminPageHeader eyebrow="SENDLOOM / ADMIN / USERS" title="Deletion requests" description="Review account and outreach deletion requests before permanent cleanup." actions={<Link className="button secondary" href="/admin/users">Back to users</Link>} />
    <form className={queueStyles.filters} method="get"><label>Status<select name="status" defaultValue={params.status || ""}><option value="">All statuses</option>{["PENDING_REVIEW", "PROCESSING", "COMPLETED", "REJECTED", "CANCELLED", "FAILED"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label><label>Requested from<input type="date" name="from" defaultValue={params.from || ""} /></label><label>Requested to<input type="date" name="to" defaultValue={params.to || ""} /></label><button className="button secondary" type="submit">Apply filters</button></form>
    {data.items.length ? <AdminTable headings={["User", "Request type", "Requested", "Status", "Reviewer", "Action"]}>{data.items.map((item) => <tr key={item.id}><td>{item.user.deletedAt ? `Deleted account #${item.userId.slice(0, 8)}` : item.user.email}</td><td>Account + outreach</td><td>{formatAdminInstant(item.requestedAt)}</td><td><AdminStatusBadge status={item.status.replaceAll("_", " ")} tone={item.status === "FAILED" ? "danger" : item.status === "PENDING_REVIEW" ? "warning" : "neutral"} /></td><td>{item.reviewedByAdmin?.email || "—"}</td><td><Link href={`/admin/users/deletion-requests/${item.id}`}>Review →</Link></td></tr>)}</AdminTable> : <AdminEmptyState>No deletion requests match these filters.</AdminEmptyState>}
    <AdminPagination page={data.page} pageSize={data.pageSize} count={data.count} href={href} />
  </AdminShell>;
}
