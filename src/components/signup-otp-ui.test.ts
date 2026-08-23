import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const FORMS = readFileSync("src/components/forms.tsx", "utf8");
const VERIFICATION = readFileSync("src/components/otp-verification-form.tsx", "utf8");
const OTP_INPUT = readFileSync("src/components/otp-code-input.tsx", "utf8");
const OTP_STYLES = readFileSync("src/components/otp-code-input.module.css", "utf8");

describe("signup two-stage verification UI", () => {
  it("keeps the credential stage and transitions only after challenge metadata arrives", () => {
    expect(FORMS).toContain('id="signup-email"');
    expect(FORMS).toContain('id="signup-password"');
    expect(FORMS).toContain('id="signup-confirm-password"');
    expect(FORMS).toContain("setChallenge({");
    expect(FORMS).toContain("if (challenge)");
    expect(FORMS).toContain("<OtpVerificationForm");
  });

  it("verifies, resends, changes email, and preserves the workspace destination", () => {
    expect(FORMS).toContain('verifyEndpoint="/api/auth/signup/verify"');
    expect(FORMS).toContain('resendEndpoint="/api/auth/signup/resend"');
    expect(FORMS).toContain('submitLabel="Verify email"');
    expect(FORMS).toContain('cancelLabel="Change email"');
    expect(FORMS).toContain('router.replace("/workspace")');
    expect(FORMS).not.toMatch(/fetch\("\/api\/auth\/signup"[\s\S]{0,900}router\.replace/);
  });

  it("shows masked email, inline errors, an authoritative resend countdown, and loading states", () => {
    expect(VERIFICATION).toContain("challenge.maskedEmail");
    expect(VERIFICATION).toContain('role="alert"');
    expect(VERIFICATION).toContain('role="status"');
    expect(VERIFICATION).toContain("Resend in ${resendSeconds}s");
    expect(VERIFICATION).toContain("resendSeconds > 0");
    expect(VERIFICATION).toContain("Verifying…");
  });
});

describe("accessible six-digit OTP input", () => {
  it("is one semantic numeric input with one-time-code autocomplete", () => {
    expect(OTP_INPUT).toContain('inputMode="numeric"');
    expect(OTP_INPUT).toContain('autoComplete="one-time-code"');
    expect(OTP_INPUT).toContain('pattern="[0-9]*"');
    expect(OTP_INPUT).toContain("maxLength={6}");
    expect(OTP_INPUT).toContain("Six-digit verification code");
  });

  it("sanitizes typing, fills all digits from paste, and renders six responsive slots", () => {
    expect(OTP_INPUT).toContain('replace(/\\D/g, "").slice(0, 6)');
    expect(OTP_INPUT).toContain("event.clipboardData.getData(\"text\")");
    expect(OTP_INPUT).toContain("Array.from({ length: 6 }");
    expect(OTP_STYLES).toContain("grid-template-columns: repeat(6, minmax(0, 1fr))");
    expect(OTP_STYLES).toContain(":focus-within");
  });
});
