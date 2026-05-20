import { describe, expect, it } from "vitest";

import {
  CSRF_TOKEN_HEX_LENGTH,
  csrfTokensMatch,
  generateCsrfToken,
  isValidCsrfToken
} from "@/lib/csrf";

describe("CSRF token helpers", () => {
  it("generates tokens of the expected length", () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[0-9a-f]+$/);
    expect(token.length).toBe(CSRF_TOKEN_HEX_LENGTH);
  });

  it("treats tokens of the wrong length as invalid", () => {
    expect(isValidCsrfToken("")).toBe(false);
    expect(isValidCsrfToken("abc")).toBe(false);
    expect(isValidCsrfToken("z".repeat(CSRF_TOKEN_HEX_LENGTH))).toBe(false);
    expect(isValidCsrfToken(generateCsrfToken())).toBe(true);
  });

  it("matches identical tokens and rejects mismatched ones", () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(token, token)).toBe(true);

    const other = generateCsrfToken();
    expect(csrfTokensMatch(token, other)).toBe(false);
    expect(csrfTokensMatch(undefined, token)).toBe(false);
    expect(csrfTokensMatch(token, undefined)).toBe(false);
    expect(csrfTokensMatch("not-hex", token)).toBe(false);
  });
});
