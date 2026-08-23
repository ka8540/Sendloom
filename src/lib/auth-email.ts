import { Resend } from "resend";

import { env } from "@/lib/env";

export type AuthEmailPurpose = "SIGNUP" | "PASSWORD_CHANGE";

export class AuthEmailConfigurationError extends Error {
  constructor() {
    super("Authentication email is not configured.");
    this.name = "AuthEmailConfigurationError";
  }
}

export class AuthEmailDeliveryError extends Error {
  constructor() {
    super("Authentication email could not be delivered.");
    this.name = "AuthEmailDeliveryError";
  }
}

function getAuthEmailConfig() {
  if (!env.RESEND_API_KEY || !env.DEFAULT_FROM_EMAIL) {
    throw new AuthEmailConfigurationError();
  }

  return {
    apiKey: env.RESEND_API_KEY,
    from: `${env.DEFAULT_FROM_NAME?.trim() || "Sendloom"} <${env.DEFAULT_FROM_EMAIL}>`
  };
}

function renderVerificationEmail(purpose: AuthEmailPurpose, code: string) {
  const signup = purpose === "SIGNUP";
  const subject = signup ? "Verify your Sendloom email" : "Verify your Sendloom password change";
  const heading = signup ? "Verify your email" : "Verify your password change";
  const instruction = signup
    ? "Use this verification code to finish creating your Sendloom account."
    : "Use this verification code to confirm your new password.";
  const ignored = signup
    ? "If you didn't request this, you can ignore this email."
    : "If you didn't request this change, you can ignore this email.";

  const text = [
    "Sendloom",
    "",
    heading,
    "",
    instruction,
    "",
    code,
    "",
    "This code expires in 10 minutes.",
    "",
    ignored
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f3f6f8;color:#15221f;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #dfe7e4;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:30px 32px 14px;font-size:18px;font-weight:750;color:#157c5a;">Sendloom</td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px;">
                <h1 style="margin:8px 0 12px;font-size:26px;line-height:1.25;letter-spacing:-0.02em;color:#15221f;">${heading}</h1>
                <p style="margin:0;color:#536460;font-size:16px;line-height:1.6;">${instruction}</p>
                <div style="margin:26px 0;padding:18px 20px;border-radius:14px;background:#edf8f4;border:1px solid #cde8de;text-align:center;font-family:'SFMono-Regular',Consolas,monospace;font-size:34px;font-weight:750;letter-spacing:0.26em;color:#116b4f;">${code}</div>
                <p style="margin:0 0 10px;color:#536460;font-size:14px;line-height:1.6;">This code expires in 10 minutes.</p>
                <p style="margin:0;color:#73817e;font-size:13px;line-height:1.6;">${ignored}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

/** Sendloom-owned transactional mail; never uses a user's connected Gmail. */
export async function sendAuthVerificationCode(input: {
  to: string;
  purpose: AuthEmailPurpose;
  code: string;
}) {
  const config = getAuthEmailConfig();
  const message = renderVerificationEmail(input.purpose, input.code);

  try {
    const result = await new Resend(config.apiKey).emails.send({
      from: config.from,
      to: input.to,
      subject: message.subject,
      html: message.html,
      text: message.text
    });

    if (result.error) {
      console.error("[auth-email] Resend rejected a verification email.", {
        providerErrorName: result.error.name
      });
      throw new AuthEmailDeliveryError();
    }
  } catch (error) {
    if (error instanceof AuthEmailDeliveryError) {
      throw error;
    }

    // Do not log provider messages or request bodies: either could echo email
    // content. The error class is enough operational signal without OTP/PII.
    console.error("[auth-email] Resend verification delivery failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    throw new AuthEmailDeliveryError();
  }
}
