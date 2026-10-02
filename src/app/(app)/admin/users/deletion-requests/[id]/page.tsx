import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminUser } from "@/lib/auth";
import { getDeletionRequestDetail } from "@/services/account-deletion";
import { AdminPageHeader, AdminShell, AdminStatusBadge } from "@/components/admin-v2/admin-ui";
import { formatAdminInstant } from "@/components/admin-v2/format";
import { DeletionReviewActions } from "@/components/admin-v2/deletion-review-actions";
import styles from "./request.module.css";

export default async function DeletionRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminUser();
  const { id } = await params;
  const request = await getDeletionRequestDetail(id);
  if (!request) notFound();
  return <AdminShell>
    <AdminPageHeader eyebrow="SENDLOOM / ADMIN / USERS" title="Review deletion request" description="Check the impact before approving permanent removal." actions={<Link className="button secondary" href="/admin/users/deletion-requests">Back to requests</Link>} />
    <div className={styles.grid}><section className={styles.card}><span className={styles.eyebrow}>REQUEST</span><h2>{request.user.deletedAt ? `Deleted account #${request.userId.slice(0, 8)}` : request.user.email}</h2><dl><div><dt>Type</dt><dd>Account + outreach data</dd></div><div><dt>Requested</dt><dd>{formatAdminInstant(request.requestedAt)}</dd></div><div><dt>Status</dt><dd><AdminStatusBadge status={request.status.replaceAll("_", " ")} tone={request.status === "FAILED" ? "danger" : request.status === "PENDING_REVIEW" ? "warning" : "neutral"} /></dd></div><div><dt>Reviewer</dt><dd>{request.reviewedByAdmin?.email || "—"}</dd></div></dl></section><section className={styles.card}><span className={styles.eyebrow}>PRIVATE DATA IMPACT</span><h2>Workspace records</h2><div className={styles.counts}>{Object.entries(request.impact).map(([label, count]) => <div key={label}><strong>{count.toLocaleString()}</strong><span>{label}</span></div>)}</div><p className={styles.note}>Audit/security history will be retained and identity-sanitized. Shared public Discover knowledge remains available.</p></section></div>
    {request.failureReason && <p className={styles.failure}>{request.failureReason}</p>}
    {(request.status === "PENDING_REVIEW" || request.status === "FAILED" || (request.status === "PROCESSING" && request.processingStartedAt && request.processingStartedAt.getTime() < Date.now() - 24 * 60 * 60 * 1000)) && <DeletionReviewActions requestId={request.id} status={request.status} />}
  </AdminShell>;
}
