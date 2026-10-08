/** Comparison key only; stored column and template names retain their original spelling. */
export function normalizeTemplateFieldName(value: string) {
  return value.trim().toLowerCase();
}

export class TemplateFieldCollisionError extends Error {}

export function assertUniqueTemplateFieldNames(fieldNames: Iterable<string>) {
  const originalNames = new Map<string, string>();

  for (const fieldName of fieldNames) {
    const normalized = normalizeTemplateFieldName(fieldName);
    const previous = originalNames.get(normalized);
    if (previous !== undefined && previous !== fieldName) {
      throw new TemplateFieldCollisionError(
        `Ambiguous template fields: "${previous}" and "${fieldName}" differ only by case or surrounding whitespace.`
      );
    }
    originalNames.set(normalized, fieldName);
  }
}

export function buildTemplateFieldLookup<T>(fields: Record<string, T>) {
  assertUniqueTemplateFieldNames(Object.keys(fields));
  return new Map(Object.entries(fields).map(([name, value]) => [normalizeTemplateFieldName(name), value]));
}
