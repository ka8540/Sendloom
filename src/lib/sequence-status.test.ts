import { describe, expect, it } from "vitest";

import { formatSequenceStatus } from "@/lib/sequence-status";

describe("waiting sequence status", () => {
  it("renders a calm waiting label rather than an error label", () => {
    expect(formatSequenceStatus("WAITING_FOR_SLOT")).toBe("Waiting for slot");
    expect(formatSequenceStatus("WAITING_FOR_SLOT")).not.toMatch(/failed|attention/i);
  });
});
