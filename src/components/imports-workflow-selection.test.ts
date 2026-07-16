import { describe, expect, it } from "vitest";

import {
  getRequestedImportId,
  resolveInitialImportId,
  type ImportSelectionCandidate
} from "@/components/imports-workflow-selection";

const candidates: ImportSelectionCandidate[] = [
  { importId: "latest-saved" },
  { importId: "discover-pending" },
  { importId: "older-pending" }
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
    expect(getRequestedImportId({ selectedImportId: "selected-3" })).toBe("selected-3");
    expect(getRequestedImportId({ listId: ["list-3", "ignored"] })).toBe("list-3");
    expect(getRequestedImportId({ audienceId: "audience-4" })).toBe("audience-4");
  });

  it("selects the exact requested owned import even when it is already mapped", () => {
    expect(resolveInitialImportId(candidates, "latest-saved")).toBe("latest-saved");
  });

  it("keeps normal direct page loads in library mode when no context is supplied", () => {
    expect(resolveInitialImportId(candidates)).toBeUndefined();
  });

  it("never selects an unknown query id outside the loaded user imports", () => {
    expect(resolveInitialImportId(candidates, "not-owned-or-missing")).toBeUndefined();
    expect(resolveInitialImportId([], "not-owned-or-missing")).toBeUndefined();
  });
});
