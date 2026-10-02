export function adminUsersSearchHref(currentSearch: string, query: string) {
  const params = new URLSearchParams(currentSearch);
  const value = query.trim().slice(0, 120);
  if (value) params.set("q", value);
  else params.delete("q");
  params.delete("page");
  const search = params.toString();
  return `/admin/users${search ? `?${search}` : ""}`;
}
