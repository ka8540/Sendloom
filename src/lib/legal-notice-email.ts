import { Resend } from "resend";

import { env } from "@/lib/env";
import type { LegalPolicyId, LegalPolicyPath } from "@/lib/legal-policies";

export type LegalNoticeEmailPolicy = {
  id: LegalPolicyId;
  title: string;
  path: LegalPolicyPath;
  version: string;
  lastUpdated: string;
  changeSummary: readonly string[];
};

export type LegalNoticeDeliveryResult =
  | { status: "accepted"; providerMessageId: string }
  | { status: "retryable"; errorCode: string; stopRun: true }
  | { status: "permanent"; errorCode: string };

export type LegalNoticeMailer = {
  isConfigured(): boolean;
  send(input: {
    to: string;
    policy: LegalNoticeEmailPolicy;
    idempotencyKey: string;
  }): Promise<LegalNoticeDeliveryResult>;
};

const SUBJECTS: Record<LegalPolicyId, string> = {
  terms: "We updated our Terms of Service",
  privacy: "We updated our Privacy Policy",
  abuse: "We updated our Anti-Abuse Policy"
};

const CTA_LABELS: Record<LegalPolicyId, string> = {
  terms: "Review the updated Terms",
  privacy: "Review the updated Privacy Policy",
  abuse: "Review the updated Anti-Abuse Policy"
};

const PERMANENT_PROVIDER_ERRORS = new Set([
  // These can identify a bad individual recipient. Configuration/auth/sender
  // failures intentionally fall through to retryable+stop so one deployment
  // mistake cannot mark an entire account population permanently failed.
  "invalid_parameter",
  "validation_error"
]);

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildCanonicalPolicyUrl(appBaseUrl: string, path: LegalPolicyPath) {
  const base = new URL(appBaseUrl);
  base.pathname = path;
  base.search = "";
  base.hash = "";
  return base.toString().replace(/\/$/, "");
}

/** Safe preview renderer: returns HTML/text only and never performs delivery. */
export function renderLegalNoticeEmail(input: { policy: LegalNoticeEmailPolicy; appBaseUrl: string }) {
  const { policy } = input;
  if (policy.changeSummary.length === 0 || policy.changeSummary.some((item) => !item.trim())) {
    throw new Error("Legal notice emails require a non-empty developer-written change summary.");
  }

  const subject = SUBJECTS[policy.id];
  const reviewUrl = buildCanonicalPolicyUrl(input.appBaseUrl, policy.path);
  const ctaLabel = CTA_LABELS[policy.id];
  const summaryText = policy.changeSummary.map((item) => `• ${item}`).join("\n");
  const text = [
    "Sendloom",
    "",
    subject,
    "",
    `We've made some updates to our ${policy.title}.`,
    "",
    "What's changed",
    "",
    summaryText,
    "",
    `Last updated: ${policy.lastUpdated}`,
    "",
    `${ctaLabel}: ${reviewUrl}`,
    "",
    `You can also review it anytime at ${reviewUrl}.`,
    "",
    "You're receiving this service notice because you have a Sendloom account.",
    "",
    "Sendloom"
  ].join("\n");

  const summaryHtml = policy.changeSummary
    .map(
      (item) =>
        `<li style="margin:0 0 10px;color:#445651;font-size:15px;line-height:1.6;">${escapeHtml(item)}</li>`
    )
    .join("");
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
  </head>
  <body style="margin:0;background:#f3f6f8;color:#15221f;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dfe7e4;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:30px 32px 14px;font-size:18px;font-weight:750;color:#157c5a;">Sendloom</td>
            </tr>
            <tr>
              <td style="padding:0 32px 34px;">
                <h1 style="margin:8px 0 12px;font-size:28px;line-height:1.25;letter-spacing:-0.02em;color:#15221f;">${escapeHtml(subject)}</h1>
                <p style="margin:0 0 24px;color:#536460;font-size:16px;line-height:1.65;">We've made some updates to our ${escapeHtml(policy.title)}.</p>
                <div style="margin:0 0 24px;padding:20px 22px;border-radius:14px;background:#edf8f4;border:1px solid #cde8de;">
                  <h2 style="margin:0 0 12px;font-size:17px;line-height:1.4;color:#15221f;">What's changed</h2>
                  <ul style="margin:0;padding-left:20px;">${summaryHtml}</ul>
                </div>
                <p style="margin:0 0 24px;color:#536460;font-size:14px;line-height:1.6;"><strong>Last updated:</strong> ${escapeHtml(policy.lastUpdated)}</p>
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="border-radius:10px;background:#157c5a;">
                      <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;padding:13px 20px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">${escapeHtml(ctaLabel)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 22px;color:#687773;font-size:13px;line-height:1.6;">You can also review it anytime at <a href="${escapeHtml(reviewUrl)}" style="color:#157c5a;">${escapeHtml(reviewUrl)}</a>.</p>
                <div style="padding-top:20px;border-top:1px solid #e5ebe9;">
                  <p style="margin:0;color:#7a8783;font-size:12px;line-height:1.6;">You're receiving this service notice because you have a Sendloom account.</p>
                  <p style="margin:10px 0 0;color:#52635e;font-size:13px;font-weight:700;">Sendloom</p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text, reviewUrl };
}

export const resendLegalNoticeMailer: LegalNoticeMailer = {
  isConfigured() {
    return Boolean(env.RESEND_API_KEY && env.DEFAULT_FROM_EMAIL);
  },

  async send(input) {
    if (!env.RESEND_API_KEY || !env.DEFAULT_FROM_EMAIL) {
      return { status: "retryable", errorCode: "RESEND_NOT_CONFIGURED", stopRun: true };
    }

    const message = renderLegalNoticeEmail({ policy: input.policy, appBaseUrl: env.APP_BASE_URL });

    try {
      const result = await new Resend(env.RESEND_API_KEY).emails.send(
        {
          from: `${env.DEFAULT_FROM_NAME?.trim() || "Sendloom"} <${env.DEFAULT_FROM_EMAIL}>`,
          to: input.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          tags: [
            { name: "category", value: "legal-policy-notice" },
            { name: "policy", value: input.policy.id }
          ]
        },
        { idempotencyKey: input.idempotencyKey }
      );

      if (result.error) {
        const errorCode = result.error.name;
        if (PERMANENT_PROVIDER_ERRORS.has(errorCode)) {
          return { status: "permanent", errorCode };
        }
        return { status: "retryable", errorCode, stopRun: true };
      }

      return { status: "accepted", providerMessageId: result.data.id };
    } catch (error) {
      // Provider/network messages can echo request content. Log only a safe
      // error class; the processor records a normalized code on the recipient.
      console.error("[legal-notice-email] Resend delivery failed.", {
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
      return { status: "retryable", errorCode: "RESEND_NETWORK_ERROR", stopRun: true };
    }
  }
};
