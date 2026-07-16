export const IMPORT_CONTEXT_KEYS = ["pendingImportId", "importId", "listId", "audienceId"] as const;

type ImportsSearchParams = Record<string, string | string[] | undefined>;

export type ImportSelectionCandidate = {
  importId: string;
  needsFieldSelection: boolean;
};

/**
 * Read the import context already carried into Imports. `pendingImportId` is
 * the established Discover contract; the remaining ID-shaped aliases let
 * other existing entry points provide the same context without changing how
 * Discover creates or routes imports.
 */
export function getRequestedImportId(searchParams: ImportsSearchParams): string | undefined {
  for (const key of IMPORT_CONTEXT_KEYS) {
    const rawValue = searchParams[key];
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (value?.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

/**
 * Resolve only against imports already loaded for the current user. Explicit
 * route context wins, followed by the newest import that still needs field
 * selection, then the newest import overall. Callers provide newest-first
 * candidates, matching the Imports page query order.
 */
export function resolveInitialImportId(
  candidates: ImportSelectionCandidate[],
  requestedImportId?: string
): string | undefined {
  if (requestedImportId && candidates.some((candidate) => candidate.importId === requestedImportId)) {
    return requestedImportId;
  }

  return candidates.find((candidate) => candidate.needsFieldSelection)?.importId ?? candidates[0]?.importId;
}
