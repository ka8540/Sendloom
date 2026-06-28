import { describe, expect, it } from "vitest";

import { decryptReporterRef, encryptReporterRef, reporterPseudonym } from "@/lib/incident/identity";

describe("reporterPseudonym", () => {
  it("is stable for one user and different across users", () => {
    expect(reporterPseudonym("user_1")).toBe(reporterPseudonym("user_1"));
    expect(reporterPseudonym("user_1")).not.toBe(reporterPseudonym("user_2"));
  });

  it("renders as the anonymous U-XXXX-XXXX code (never the raw id)", () => {
    const code = reporterPseudonym("ckxyz123raw-database-id");
    expect(code).toMatch(/^U-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(code).not.toContain("ckxyz123");
  });
});

describe("encryptReporterRef / decryptReporterRef (AES-256-GCM)", () => {
  it("uses a fresh IV each time, so the same user encrypts to different ciphertext", () => {
    const a = encryptReporterRef("user_1");
    const b = encryptReporterRef("user_1");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("round-trips back to the original user id", () => {
    const enc = encryptReporterRef("user_42");
    expect(decryptReporterRef(enc)).toBe("user_42");
  });

  it("fails authentication when the ciphertext is tampered with", () => {
    const enc = encryptReporterRef("user_1");
    const tampered = { ...enc, ciphertext: Buffer.from("totally-different-bytes").toString("base64url") };
    expect(() => decryptReporterRef(tampered)).toThrow();
  });
});
