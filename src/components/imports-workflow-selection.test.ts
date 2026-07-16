import { describe, expect, it } from "vitest";

import {
  getRequestedImportId,
  resolveInitialImportId,
  type ImportSelectionCandidate
} from "@/components/imports-workflow-selection";

const candidates: ImportSelectionCandidate[] = [
  { importId: "latest-saved", needsFieldSelection: false },
  { importId: "discover-pending", needsFieldSelection: true },
  { importId: "older-pending", needsFieldSelection: true }
];

describe("Imports workflow context selection", () => {
  it("keeps the established Discover pendingImportId contract as the first priority", () => {
    expect(getRequestedImportId({
      pendingImportId: "discover-pending",
      importId: "latest-saved"
    })).toBe("discover-pending");
  });

  it("accepts existing ID-shaped context aliases and array query values", () => {
    expect(getRequestedImportId({ importId: "import-2" })).toBe("import-2");
    expect(getRequestedImportId({ listId: ["list-3", "ignored"] })).toBe("list-3");
    expect(getRequestedImportId({ audienceId: "audience-4" })).toBe("audience-4");
  });

  it("selects the exact requested owned import even when it is already mapped", () => {
    expect(resolveInitialImportId(candidates, "latest-saved")).toBe("latest-saved");
  });

  it("falls back to the newest pending import, then the newest import overall", () => {
    expect(resolveInitialImportId(candidates)).toBe("discover-pending");
    expect(resolveInitialImportId([
      { importId: "latest-saved", needsFieldSelection: false },
      { importId: "older-saved", needsFieldSelection: false }
    ])).toBe("latest-saved");
  });

  it("never selects an unknown query id outside the loaded user imports", () => {
    expect(resolveInitialImportId(candidates, "not-owned-or-missing")).toBe("discover-pending");
    expect(resolveInitialImportId([], "not-owned-or-missing")).toBeUndefined();
  });
});
