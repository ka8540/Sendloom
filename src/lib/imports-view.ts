/**
 * Pure helpers that decide where an import is shown on the Imports page.
 *
 * The page renders two surfaces that must never show the same Discover import
 * at once:
 *  - the Template fields picker (imports still awaiting field selection), and
 *  - the completed Imports list (finalized/processed imports).
 *
 * Status is the source of truth. A pending import (status `UPLOADING`, created
 * by the Discover "Add to Imports" flow) belongs only in the picker until its
 * fields are saved, at which point it transitions to `PROCESSED` and moves to
 * the list. Manual uploads keep their existing behavior: created `PROCESSED`
 * with a default mapping, they appear in the picker until their fields are
 * explicitly reconfigured and always appear in the list.
 */

/** Import status representing an import awaiting template-field selection. */
export const PENDING_IMPORT_STATUS = "UPLOADING";

export type ImportMappingTimestamps = {
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Whether an import should appear in the Template fields picker (it still needs
 * field selection).
 *
 * - Pending imports (`UPLOADING`) always need field selection.
 * - Processed imports appear until their mapping has been explicitly
 *   reconfigured, detected by an updatedAt that differs from createdAt. A
 *   pending import is created with its mapping up front, so once
 *   `saveTemplateFields` updates that mapping the timestamps diverge and the
 *   import leaves the picker.
 */
export function importNeedsFieldSelection(
  status: string,
  mapping: ImportMappingTimestamps | null | undefined
): boolean {
  if (status === PENDING_IMPORT_STATUS) {
    return true;
  }

  const hasBeenConfigured = mapping ? mapping.updatedAt.getTime() !== mapping.createdAt.getTime() : false;
  return !hasBeenConfigured;
}

/**
 * Whether an import should appear in the completed Imports list. Pending imports
 * are excluded until they are finalized.
 */
export function importIsFinalized(status: string): boolean {
  return status !== PENDING_IMPORT_STATUS;
}
