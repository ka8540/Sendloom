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
    policies: readonly LegalNoticeEmailPolicy[];
    releaseGroup: string;
    idempotencyKey: string;
  }): Promise<LegalNoticeDeliveryResult>;
};

const SUBJECTS: Record<LegalPolicyId, string> = {
  terms: "We updated our Terms of Service",
  privacy: "We updated our Privacy Policy",
  abuse: "We updated our Anti-Abuse Policy"
};

const CTA_LABELS: Record<LegalPolicyId, string> = {
  terms: "Review Terms of Service",
  privacy: "Review Privacy Policy",
  abuse: "Review Anti-Abuse Policy"
};

const POLICY_GLYPHS: Record<LegalPolicyId, string> = {
  terms: "&#9636;",
  privacy: "&#9919;",
  abuse: "&#9960;"
};

const POLICY_ORDER: Record<LegalPolicyId, number> = { terms: 0, privacy: 1, abuse: 2 };

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

export function sortLegalNoticePolicies(policies: readonly LegalNoticeEmailPolicy[]) {
  return [...policies].sort((left, right) => POLICY_ORDER[left.id] - POLICY_ORDER[right.id]);
}

/** Safe preview renderer: returns HTML/text only and never performs delivery. */
export function renderLegalNoticeEmail(input: {
  policies: readonly LegalNoticeEmailPolicy[];
  appBaseUrl: string;
}) {
  if (input.policies.length === 0) {
    throw new Error("Legal notice emails require at least one policy.");
  }

  const policies = sortLegalNoticePolicies(input.policies);
  const policyIds = new Set<LegalPolicyId>();
  for (const policy of policies) {
    if (policyIds.has(policy.id)) throw new Error(`Duplicate legal policy in release email: ${policy.id}`);
    policyIds.add(policy.id);
    if (policy.changeSummary.length === 0 || policy.changeSummary.some((item) => !item.trim())) {
      throw new Error("Legal notice emails require a non-empty developer-written change summary for every policy.");
    }
  }

  const multiple = policies.length > 1;
  const subject = multiple ? "We updated our policies" : SUBJECTS[policies[0].id];
  const intro = multiple
    ? "We've made updates to several Sendloom policies. Review the key changes below."
    : `We've made some updates to our ${policies[0].title}. Review the key changes below.`;
  const reviewUrls = Object.fromEntries(
    policies.map((policy) => [policy.id, buildCanonicalPolicyUrl(input.appBaseUrl, policy.path)])
  ) as Partial<Record<LegalPolicyId, string>>;
  const logoUrl = new URL("/icon-192.png", input.appBaseUrl).toString();

  const textSections = policies.map((policy) => {
    const reviewUrl = reviewUrls[policy.id]!;
    return [
      "------------------------------------------------",
      "",
      policy.title,
      `Last updated: ${policy.lastUpdated}`,
      "",
      "What's changed",
      ...policy.changeSummary.map((item) => `• ${item}`),
      "",
      `${CTA_LABELS[policy.id]}: ${reviewUrl}`
    ].join("\n");
  });
  const text = [
    "Sendloom",
    "",
    subject,
    "",
    intro,
    "",
    ...textSections,
    "",
    "------------------------------------------------",
    "",
    "Your trust matters",
    "We're committed to transparency and keeping you informed about important updates to our policies and practices.",
    "",
    "------------------------------------------------",
    "",
    "You're receiving this service notice because you have a Sendloom account.",
    "",
    "© 2026 Sendloom. All rights reserved."
  ].join("\n");

  const policySectionsHtml = policies
    .map((policy) => {
      const reviewUrl = reviewUrls[policy.id]!;
      const summaryHtml = policy.changeSummary
        .map(
          (item) =>
            `<li style="margin:0 0 8px;color:#536460;font-size:14px;line-height:1.55;">${escapeHtml(item)}</li>`
        )
        .join("");
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #dfe7e4;border-collapse:separate;border-radius:16px;background:#ffffff;">
                  <tr>
                    <td width="38" valign="top" style="width:38px;padding:18px 0 18px 16px;">
                      <table role="presentation" width="36" cellspacing="0" cellpadding="0" style="width:36px;height:36px;border:1px solid #cde8de;border-radius:11px;background:#edf8f4;">
                        <tr>
                          <td align="center" valign="middle" aria-hidden="true" style="height:36px;color:#157c5a;font-family:'Segoe UI Symbol',Arial,sans-serif;font-size:18px;line-height:18px;">${POLICY_GLYPHS[policy.id]}</td>
                        </tr>
                      </table>
                    </td>
                    <td valign="top" style="padding:17px 16px 18px 12px;">
                      <h2 style="margin:0 0 5px;color:#15221f;font-size:19px;font-weight:700;line-height:1.35;letter-spacing:-0.01em;">${escapeHtml(policy.title)}</h2>
                      <p style="margin:0;color:#7a8783;font-size:13px;line-height:1.55;"><strong style="color:#157c5a;font-weight:700;">Last updated:</strong> ${escapeHtml(policy.lastUpdated)}</p>
                      <div style="height:1px;margin:14px 0;background:#dfe7e4;font-size:0;line-height:0;">&nbsp;</div>
                      <h3 style="margin:0 0 8px;color:#15221f;font-size:14px;font-weight:700;line-height:1.4;">What's changed</h3>
                      <ul style="margin:0 0 16px;padding-left:19px;">${summaryHtml}</ul>
                      <table role="presentation" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="border-radius:999px;background:#157c5a;">
                            <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;border-radius:999px;padding:12px 21px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;line-height:1.2;">${escapeHtml(CTA_LABELS[policy.id])}&nbsp;&nbsp;&#8594;</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <div style="height:14px;font-size:0;line-height:14px;">&nbsp;</div>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body style="margin:0;padding:0;background:#f3f6f8;color:#15221f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#f3f6f8;">
      <tr>
        <td align="center" style="padding:32px 14px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;border:1px solid #dfe7e4;border-collapse:separate;border-radius:20px;background:#ffffff;overflow:hidden;">
            <tr>
              <td align="center" style="padding:28px 28px 24px;">
                <table role="presentation" align="center" cellspacing="0" cellpadding="0">
                  <tr>
                    <td valign="middle" style="padding-right:10px;">
                      <img src="${escapeHtml(logoUrl)}" width="40" height="40" alt="Sendloom" style="display:block;width:40px;height:40px;border:0;border-radius:10px;outline:none;text-decoration:none;">
                    </td>
                    <td valign="middle" style="color:#15221f;font-size:23px;font-weight:750;line-height:1;letter-spacing:-0.03em;white-space:nowrap;"><span style="color:#15221f;">Send</span><span style="color:#23a774;">loom</span></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="border-top:1px solid #e4efeb;border-bottom:1px solid #e4efeb;background:#edf8f4;padding:24px 30px 27px;">
                <table role="presentation" align="center" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="border:1px solid #cde8de;border-radius:999px;background:#ffffff;padding:7px 13px;color:#157c5a;font-size:11px;font-weight:700;line-height:1;letter-spacing:0.12em;">POLICY UPDATE</td>
                  </tr>
                </table>
                <h1 style="margin:16px 0 9px;color:#15221f;font-size:29px;font-weight:750;line-height:1.2;letter-spacing:-0.025em;">${escapeHtml(subject)}</h1>
                <p style="max-width:470px;margin:0 auto;color:#536460;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 20px 12px;">
                ${policySectionsHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:0 20px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #d7ebe4;border-collapse:separate;border-radius:12px;background:#f4faf8;">
                  <tr>
                    <td width="36" valign="middle" style="width:36px;padding:15px 0 15px 17px;">
                      <table role="presentation" width="32" cellspacing="0" cellpadding="0" style="width:32px;height:32px;border:1px solid #cde8de;border-radius:16px;background:#ffffff;">
                        <tr>
                          <td align="center" valign="middle" aria-hidden="true" style="height:32px;color:#157c5a;font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:16px;">&#10003;</td>
                        </tr>
                      </table>
                    </td>
                    <td style="padding:14px 17px 14px 12px;">
                      <p style="margin:0 0 2px;color:#15221f;font-size:13px;font-weight:700;line-height:1.4;">Your trust matters</p>
                      <p style="margin:0;color:#536460;font-size:12px;line-height:1.55;">We're committed to transparency and keeping you informed about important updates to our policies and practices.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #dfe7e4;background:#fbfcfc;padding:20px 28px 24px;">
                <p style="margin:0;color:#7a8783;font-size:12px;line-height:1.6;">You're receiving this service notice because you have a Sendloom account.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin-top:10px;">
                  <tr>
                    <td valign="bottom" style="color:#7a8783;font-size:12px;line-height:1.5;">© 2026 Sendloom. All rights reserved.</td>
                    <td align="right" valign="bottom" style="padding-left:12px;color:#15221f;font-size:14px;font-weight:700;line-height:1.2;white-space:nowrap;"><span style="color:#15221f;">Send</span><span style="color:#23a774;">loom</span></td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text, reviewUrls, policies };
}

export const resendLegalNoticeMailer: LegalNoticeMailer = {
  isConfigured() {
    return Boolean(env.RESEND_API_KEY && env.DEFAULT_FROM_EMAIL);
  },

  async send(input) {
    if (!env.RESEND_API_KEY || !env.DEFAULT_FROM_EMAIL) {
      return { status: "retryable", errorCode: "RESEND_NOT_CONFIGURED", stopRun: true };
    }

    const message = renderLegalNoticeEmail({ policies: input.policies, appBaseUrl: env.APP_BASE_URL });

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
            { name: "policy_count", value: String(message.policies.length) },
            { name: "release_group", value: input.releaseGroup }
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
