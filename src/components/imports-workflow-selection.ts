export const IMPORT_CONTEXT_KEYS = [
  "pendingImportId",
  "importId",
  "selectedImportId",
  "listId",
  "audienceId"
] as const;

type ImportsSearchParams = Record<string, string | string[] | undefined>;

export type ImportSelectionCandidate = {
  importId: string;
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
 * Client-side twin of `getRequestedImportId`: true when the current URL
 * identifies the Imports workflow — an import context id or a `step` marker
 * (Discover hands off with `pendingImportId=…&step=map`, Add import stamps
 * `step=upload`). The shell back button uses this to exit straight to the
 * /imports library instead of walking browser history back out of Imports.
 */
export function hasImportWorkflowContext(searchParams: Pick<URLSearchParams, "get">): boolean {
  if (searchParams.get("step")?.trim()) {
    return true;
  }

  return IMPORT_CONTEXT_KEYS.some((key) => Boolean(searchParams.get(key)?.trim()));
}

/**
 * Resolve route context only against the current user's imports that still
 * need field mapping. With no valid explicit context, Imports stays in library
 * mode; a saved import can never be reopened in this workflow by query alone.
 */
export function resolveInitialImportId(
  candidates: ImportSelectionCandidate[],
  requestedImportId?: string
): string | undefined {
  return requestedImportId && candidates.some((candidate) => candidate.importId === requestedImportId)
    ? requestedImportId
    : undefined;
}
