function quote(value: string): string {
  return `"${value.normalize("NFC").replace(/["\\\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}"`;
}
export function buildPublicPeopleSearchQuery(input: { companyName: string; jobTitle: string; location?: string | null }): string {
  return ['site:linkedin.com/in', quote(input.companyName), quote(input.jobTitle),
    ...(input.location?.trim() ? [quote(input.location)] : [])].join(' ');
}
