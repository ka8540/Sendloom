import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FORMS = readFileSync("src/components/forms.tsx", "utf8");
const LOGIN = readFileSync("src/app/login/page.tsx", "utf8");
const FORGOT_PAGE = readFileSync("src/app/forgot-password/page.tsx", "utf8");
const AUTH_PAGE = readFileSync("src/components/auth-page.tsx", "utf8");

describe("forgot-password UI source contract", () => {
  it("adds a semantic login link without changing the login page composition", () => {
    expect(FORMS).toContain('href={"/forgot-password" as Route}');
    expect(FORMS).toContain("Forgot password?");
    expect(LOGIN).toContain("<AuthPage");
    expect(LOGIN).toContain("<LoginForm />");
  });

  it("uses AuthPage and preserves its existing auth video implementation", () => {
    expect(FORGOT_PAGE).toContain("<AuthPage");
    expect(FORGOT_PAGE).toContain('eyebrow="Account recovery"');
    expect(FORGOT_PAGE).toContain('title="Reset your password"');
    expect(FORGOT_PAGE).toContain('switchLabel="Back to sign in"');
    expect(AUTH_PAGE).toContain("<AuthVideoPreview />");
  });

  it("implements email, OTP, new-password, and success states in component memory", () => {
    expect(FORMS).toContain('type PasswordResetStep = "EMAIL" | "OTP" | "NEW_PASSWORD" | "SUCCESS"');
    expect(FORMS).toContain('verifyEndpoint="/api/auth/password-reset/verify"');
    expect(FORMS).toContain('resendEndpoint="/api/auth/password-reset/resend"');
    expect(FORMS).toContain('step === "NEW_PASSWORD" && resetGrant');
    expect(FORMS).toContain('step === "SUCCESS"');
    expect(FORMS).toContain("Your password has been updated. You can now sign in with your new password.");
  });

  it("never persists the challenge, grant, email, OTP, or password in browser storage or URLs", () => {
    const recoverySource = `${FORMS}\n${FORGOT_PAGE}`;
    expect(recoverySource).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(recoverySource).not.toMatch(/URLSearchParams|window\.location\.(search|hash)/);
  });
});
