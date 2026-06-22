import { describe, expect, it } from "vitest";

import { importIsFinalized, importNeedsFieldSelection } from "@/lib/imports-view";

function mapping(createdAtMs: number, updatedAtMs: number) {
  return { createdAt: new Date(createdAtMs), updatedAt: new Date(updatedAtMs) };
}

describe("importNeedsFieldSelection (Template fields picker membership)", () => {
  it("always includes pending imports (awaiting first field selection)", () => {
    expect(importNeedsFieldSelection("UPLOADING", null)).toBe(true);
    // A pending Discover import is created with an unmodified mapping up front.
    expect(importNeedsFieldSelection("UPLOADING", mapping(1000, 1000))).toBe(true);
  });

  it("excludes a finalized import whose mapping has been saved", () => {
    // After saveTemplateFields the mapping is updated, so the timestamps differ.
    expect(importNeedsFieldSelection("PROCESSED", mapping(1000, 2000))).toBe(false);
  });

  it("keeps a freshly uploaded import (default mapping not yet reconfigured)", () => {
    expect(importNeedsFieldSelection("PROCESSED", mapping(1000, 1000))).toBe(true);
    expect(importNeedsFieldSelection("PROCESSED", null)).toBe(true);
  });
});

describe("importIsFinalized (completed Imports list membership)", () => {
  it("excludes pending imports and includes everything else", () => {
    expect(importIsFinalized("UPLOADING")).toBe(false);
    expect(importIsFinalized("PROCESSED")).toBe(true);
    expect(importIsFinalized("FAILED")).toBe(true);
  });
});

describe("Discover import lifecycle never shows in both surfaces at once", () => {
  it("a pending import is only in the picker", () => {
    const status = "UPLOADING";
    const pendingMapping = mapping(1000, 1000); // empty, created up front
    expect(importNeedsFieldSelection(status, pendingMapping)).toBe(true);
    expect(importIsFinalized(status)).toBe(false);
  });

  it("a finalized import is only in the completed list", () => {
    const status = "PROCESSED";
    const savedMapping = mapping(1000, 5000); // updated by saveTemplateFields
    expect(importNeedsFieldSelection(status, savedMapping)).toBe(false);
    expect(importIsFinalized(status)).toBe(true);
  });
});
