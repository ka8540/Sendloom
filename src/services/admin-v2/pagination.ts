export function normalizeAdminPage(
  value: number,
  count: number,
  pageSize: number,
) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const requested = Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, Math.min(pages, requested));
}
