import { assertUniqueTemplateFieldNames, buildTemplateFieldLookup, normalizeTemplateFieldName } from "@/lib/template-fields";
import type { MergeVariables, ReservedFieldMap, VariableMap } from "@/lib/types";

type MappingSnapshot = {
  reservedFieldMap?: ReservedFieldMap;
  variableMap?: VariableMap;
};

export function buildMergePayload(
  row: Record<string, unknown>,
  mapping: MappingSnapshot
): MergeVariables {
  const payload: MergeVariables = {};
  const rowValues = buildTemplateFieldLookup(row);
  assertUniqueTemplateFieldNames([
    ...Object.keys(mapping.variableMap ?? {}),
    ...Object.keys(mapping.reservedFieldMap ?? {})
  ]);

  for (const [templateKey, sourceKey] of Object.entries(mapping.variableMap ?? {})) {
    if (!sourceKey) {
      continue;
    }

    const value = rowValues.get(normalizeTemplateFieldName(sourceKey));
    if (value !== undefined) {
      payload[templateKey] = value as MergeVariables[string];
    }
  }

  for (const [reservedKey, sourceKey] of Object.entries(mapping.reservedFieldMap ?? {})) {
    if (!sourceKey) {
      continue;
    }

    const value = rowValues.get(normalizeTemplateFieldName(sourceKey));
    if (value !== undefined) {
      payload[reservedKey] = value as MergeVariables[string];
    }
  }

  return payload;
}
