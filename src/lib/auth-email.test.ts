import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock, sendMock } = vi.hoisted(() => ({
  envMock: {
    RESEND_API_KEY: "re_test_key",
    DEFAULT_FROM_EMAIL: "security@sendloom.example",
    DEFAULT_FROM_NAME: "Sendloom"
  },
  sendMock: vi.fn()
}));

vi.mock("@/lib/env", () => ({ env: envMock }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  }
}));

import {
  AuthEmailConfigurationError,
  AuthEmailDeliveryError,
  sendAuthVerificationCode
} from "@/lib/auth-email";

beforeEach(() => {
  vi.clearAllMocks();
  envMock.RESEND_API_KEY = "re_test_key";
  envMock.DEFAULT_FROM_EMAIL = "security@sendloom.example";
  envMock.DEFAULT_FROM_NAME = "Sendloom";
  sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
});

describe("auth verification email", () => {
  it("sends branded signup HTML and plain text through Sendloom Resend infrastructure", async () => {
    await sendAuthVerificationCode({ to: "user@example.com", purpose: "SIGNUP", code: "583291" });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Sendloom <security@sendloom.example>",
        to: "user@example.com",
        subject: "Verify your Sendloom email",
        html: expect.stringContaining("583291"),
        text: expect.stringContaining("This code expires in 10 minutes.")
      })
    );
  });

  it("uses password-change-specific security copy", async () => {
    await sendAuthVerificationCode({ to: "user@example.com", purpose: "PASSWORD_CHANGE", code: "123456" });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Verify your Sendloom password change",
        text: expect.stringContaining("confirm your new password")
      })
    );
  });

  it("fails closed when Resend sender configuration is missing", async () => {
    envMock.RESEND_API_KEY = "";
    await expect(
      sendAuthVerificationCode({ to: "user@example.com", purpose: "SIGNUP", code: "123456" })
    ).rejects.toBeInstanceOf(AuthEmailConfigurationError);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized delivery error when the provider rejects the send", async () => {
    sendMock.mockResolvedValue({ data: null, error: { name: "provider_error", message: "rejected" } });
    await expect(
      sendAuthVerificationCode({ to: "user@example.com", purpose: "SIGNUP", code: "123456" })
    ).rejects.toBeInstanceOf(AuthEmailDeliveryError);
  });
});
