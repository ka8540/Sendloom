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

  for (const [templateKey, sourceKey] of Object.entries(mapping.variableMap ?? {})) {
    if (!sourceKey) {
      continue;
    }

    const value = row[sourceKey];
    if (value !== undefined) {
      payload[templateKey] = value as MergeVariables[string];
    }
  }

  for (const [reservedKey, sourceKey] of Object.entries(mapping.reservedFieldMap ?? {})) {
    if (!sourceKey) {
      continue;
    }

    const value = row[sourceKey];
    if (value !== undefined) {
      payload[reservedKey] = value as MergeVariables[string];
    }
  }

  return payload;
}
