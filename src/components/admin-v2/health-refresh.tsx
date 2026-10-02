"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
export function AdminHealthRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className="button secondary"
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      {pending ? "Checking…" : "Recheck"}
    </button>
  );
}
