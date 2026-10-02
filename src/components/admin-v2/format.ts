export const formatAdminDate = (value: Date | string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(value))
    : "Never";

export const formatAdminInstant = (value: Date | string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "Never";

export function formatAdminRelative(
  value: Date | string | null | undefined,
  now = Date.now(),
) {
  if (!value) return "Never";
  const elapsed = Math.max(0, now - new Date(value).getTime());
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 30 * 86_400_000)
    return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return formatAdminDate(value);
}
