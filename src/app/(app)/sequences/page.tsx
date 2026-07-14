import { redirect } from "next/navigation";

export default async function SequencesIndexPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    for (const entry of Array.isArray(value) ? value : value ? [value] : []) {
      query.append(key, entry);
    }
  }

  const queryString = query.toString();
  redirect(queryString ? `/campaigns?${queryString}` : "/campaigns");
}
