import { z } from "zod";

export const NAME_NORMALIZATION_VERSION = 1;
export type DiscoverNameInput = {
  firstName: string;
  lastName: string;
  fullName: string;
  sourceName?: string | null;
  nameNormalization?: string | null;
  currentTitle?: string | null;
  headline?: string | null;
  currentCompanyName?: string | null;
};
export const nameResultSchema = z.object({
  id: z.string(),
  displayName: z.string().max(500).nullable(),
  givenName: z.string().max(200).nullable(),
  familyName: z.string().max(200).nullable(),
  middleNames: z.array(z.string().max(200)).max(20),
  generationalSuffix: z.string().max(20).nullable(),
  removedTokens: z.array(z.string().max(500)).max(100),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  canGenerateEmail: z.boolean()
}).strict();
export type NameResult = z.infer<typeof nameResultSchema>;
export const tidyName = (s: string) => s.normalize("NFC").replace(/\s+/gu, " ").trim().replace(/^[,.;\s]+|[,;\s]+$/gu, "");
const words = (s: string): string[] => s.normalize("NFC").toLocaleLowerCase().match(/[\p{L}\p{M}]+/gu) ?? [];
const noise = /^(?:dr|mr|mrs|prof|phd|mba|pmp|cpa|cfa|cissp|cisa|cism|ccna|ccnp|sphr|shrmscp|shrmcp|dphil|pharmd|mbbs|dds|dmd|dvm|jd|llm|esq|recruiting|recruiter|marketing|team|hiring|growth|ceo|cto|founder|engineer|director|manager|consultant|president|sales|inc|llc|ltd)$/iu;
const isNoise = (s: string) => noise.test(s.replace(/[^\p{L}]/gu, ""));
const latinPart = /^[\p{Script=Latin}\p{M}]+(?:['’\-][\p{Script=Latin}\p{M}]+)*$/u;

/** A narrow fast path; uppercase is a reason to ask, never a reason to delete. */
export function isPlainDiscoverName(raw: string): boolean {
  const parts = tidyName(raw).split(" ");
  return parts.length === 2 && parts.every(p => latinPart.test(p) && [...p].length >= 2 &&
    p !== p.toUpperCase() && !isNoise(p)) && raw.length <= 100;
}

/** Every output token must originate in the NAME, never the contextual title/company. */
export function validateNameResult(raw: unknown, source: string, context: Pick<DiscoverNameInput, "currentTitle" | "currentCompanyName"> = {}): NameResult | null {
  const parsed = nameResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  for (const key of ["displayName", "givenName", "familyName", "generationalSuffix"] as const) {
    if (r[key] !== null) r[key] = tidyName(r[key]!) || null;
  }
  const sourceWords = words(source);
  const traceable = (s: string) => words(s).every(w => sourceWords.includes(w) ||
    // CJK names may have no spaces. Only contiguous original characters qualify.
    (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{M}]+$/u.test(w) && sourceWords.some(sw => sw.includes(w))));
  const nameValues = [r.displayName, r.givenName, r.familyName, ...r.middleNames, r.generationalSuffix].filter((s): s is string => Boolean(s));
  if (nameValues.some(s => !traceable(s) || !/^[\p{L}\p{M}\s'’.\-]+$/u.test(s))) return null;
  const components = [r.givenName, r.familyName, ...r.middleNames].filter((s): s is string => Boolean(s));
  if (components.some(s => isNoise(s) || words(s).some(isNoise))) return null;
  if (r.displayName && words(r.displayName).some(isNoise)) return null;
  if (r.familyName && [context.currentTitle, context.currentCompanyName].some(s => s && words(s).join(" ") === words(r.familyName!).join(" "))) return null;
  if (r.generationalSuffix && !/^(?:Jr\.?|Sr\.?|II|III|IV|V|VI)$/iu.test(r.generationalSuffix)) return null;
  if (r.removedTokens.some(s => !traceable(s) || components.some(c => words(s).some(w => words(c).includes(w))))) return null;
  if (components.some(s => !r.displayName || !words(s).every(w => words(r.displayName!).includes(w) || r.displayName!.includes(s)))) return null;
  // Uppercase and hyphenated names are legitimate. Shape triggers AI inspection
  // at ingress, but must not override a validated semantic name decision here.
  if (r.canGenerateEmail && (r.confidence !== "HIGH" || !r.givenName || !r.familyName ||
    /^(?:\p{L}\.)$/u.test(r.givenName) || /^(?:\p{L}\.)$/u.test(r.familyName))) r.canGenerateEmail = false;
  return r;
}

const stampSchema = z.object({ version: z.literal(NAME_NORMALIZATION_VERSION), source: z.string(),
  firstName: z.string(), lastName: z.string(), fullName: z.string(),
  canGenerateEmail: z.boolean(), nameChanged: z.boolean(), method: z.enum(["DETERMINISTIC", "AI", "FALLBACK"])
}).strict();
export function readNameStamp(person: Partial<DiscoverNameInput>) {
  try {
    const s = stampSchema.parse(JSON.parse(person.nameNormalization ?? ""));
    return s.source === person.sourceName && s.firstName === person.firstName && s.lastName === person.lastName &&
      (person.fullName === undefined || s.fullName === person.fullName) ? s : null;
  } catch { return null; }
}
export function nameStateFields(person: Partial<DiscoverNameInput>) {
  return { sourceName: person.sourceName ?? null, nameNormalization: person.nameNormalization ?? null };
}
