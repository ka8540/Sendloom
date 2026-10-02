"use client";
import {
  AdminErrorState,
  AdminShell,
  AdminPageHeader,
} from "@/components/admin-v2/admin-ui";
export default function AdminError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <AdminShell>
      <AdminPageHeader
        title="Admin workspace unavailable"
        description="We couldn't load this workspace right now."
      />
      <AdminErrorState>
        Try again. If this continues, check platform health.
      </AdminErrorState>
      <button className="button secondary" onClick={reset}>
        Retry
      </button>
    </AdminShell>
  );
}
