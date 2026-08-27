import { Resend } from "resend";

import { env } from "@/lib/env";
import type { ProductUpdateFeature } from "@/lib/product-update-broadcasts";

export type ProductUpdateEmailInput = {
  id?: string;
  subject: string;
  headline: string;
  intro: string;
  features: ProductUpdateFeature[];
  scheduledSendAt: Date | null;
  timeZone: string;
};

export type ProductUpdateDeliveryResult =
  | { status: "accepted"; providerMessageId: string }
  | { status: "retryable"; errorCode: string; stopRun: true }
  | { status: "permanent"; errorCode: string };

export type ProductUpdateMailer = {
  isConfigured(): boolean;
  send(input: {
    to: string;
    broadcast: ProductUpdateEmailInput & { id: string };
    idempotencyKey: string;
  }): Promise<ProductUpdateDeliveryResult>;
};

const PERMANENT_PROVIDER_ERRORS = new Set(["invalid_parameter", "validation_error"]);

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function htmlWithLineBreaks(value: string) {
  return escapeHtml(value).replaceAll(/\r?\n/g, "<br>");
}

function absoluteCtaUrl(path: string, appBaseUrl: string) {
  return new URL(path, appBaseUrl).toString();
}

/** Pure renderer used by both preview and delivery. It has no provider or DB side effects. */
export function renderProductUpdateEmail(input: { broadcast: ProductUpdateEmailInput; appBaseUrl: string }) {
  const { broadcast } = input;
  const logoUrl = new URL("/icon-192.png", input.appBaseUrl).toString();
  const year = new Date().getUTCFullYear();

  const featureText = broadcast.features.flatMap((feature, index) => [
    "",
    `${String(index + 1).padStart(2, "0")} — ${feature.title}`,
    feature.description,
    ...(feature.ctaHref ? [absoluteCtaUrl(feature.ctaHref, input.appBaseUrl)] : [])
  ]);
  const text = [
    "Sendloom",
    "",
    "NEW IN SENDLOOM",
    "",
    broadcast.headline,
    "",
    broadcast.intro,
    ...featureText,
    "",
    "------------------------------------------------",
    "",
    "You're receiving this product update because you have a Sendloom account.",
    `© ${year} Sendloom. All rights reserved.`
  ].join("\n");

  const featureRows = broadcast.features
    .map((feature, index) => {
      const ctaUrl = feature.ctaHref ? absoluteCtaUrl(feature.ctaHref, input.appBaseUrl) : null;
      const cta = ctaUrl && feature.ctaLabel
        ? `<table role="presentation" cellspacing="0" cellpadding="0" align="right" style="margin-top:20px;"><tr><td style="border-radius:999px;background:#157c5a;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:11px 18px;color:#ffffff;font-size:13px;font-weight:750;line-height:1;text-decoration:none;">${escapeHtml(feature.ctaLabel)}</a></td></tr></table>`
        : "";
      return `<tr>
        <td style="border-top:${index === 0 ? "0" : "1px solid #dfe7e4"};padding:26px 30px 28px;">
          <p style="margin:0 0 10px;color:#23a774;font-size:11px;font-weight:800;letter-spacing:0.12em;line-height:1;text-transform:uppercase;">${String(index + 1).padStart(2, "0")}</p>
          <h2 style="margin:0;color:#15221f;font-size:20px;font-weight:750;line-height:1.3;letter-spacing:-0.015em;">${escapeHtml(feature.title)}</h2>
          <p style="margin:10px 0 0;color:#536460;font-size:14px;line-height:1.7;">${htmlWithLineBreaks(feature.description)}</p>
          ${cta}
        </td>
      </tr>`;
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
      <tr><td align="center" style="padding:32px 14px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;border:1px solid #dfe7e4;border-collapse:separate;border-radius:20px;background:#ffffff;overflow:hidden;">
          <tr><td align="center" style="padding:28px 28px 24px;">
            <table role="presentation" align="center" cellspacing="0" cellpadding="0"><tr>
              <td valign="middle" style="padding-right:10px;"><img src="${escapeHtml(logoUrl)}" width="40" height="40" alt="Sendloom" style="display:block;width:40px;height:40px;border:0;border-radius:10px;outline:none;text-decoration:none;"></td>
              <td valign="middle" style="color:#15221f;font-size:23px;font-weight:750;line-height:1;letter-spacing:-0.03em;white-space:nowrap;"><span style="color:#15221f;">Send</span><span style="color:#23a774;">loom</span></td>
            </tr></table>
          </td></tr>
          <tr><td align="center" style="border-top:1px solid #e4efeb;border-bottom:1px solid #e4efeb;background:#edf8f4;padding:27px 30px 30px;">
            <p style="margin:0;color:#157c5a;font-size:11px;font-weight:800;letter-spacing:0.13em;line-height:1;text-transform:uppercase;">New in Sendloom</p>
            <h1 style="margin:15px 0 0;color:#15221f;font-size:29px;font-weight:750;line-height:1.2;letter-spacing:-0.025em;">${escapeHtml(broadcast.headline)}</h1>
            <p style="margin:13px auto 0;max-width:500px;color:#40534e;font-size:15px;line-height:1.7;">${htmlWithLineBreaks(broadcast.intro)}</p>
          </td></tr>
          ${featureRows}
          <tr><td style="border-top:1px solid #dfe7e4;background:#fbfcfc;padding:20px 28px 24px;">
            <p style="margin:0;color:#7a8783;font-size:12px;line-height:1.6;">You're receiving this product update because you have a Sendloom account.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin-top:10px;"><tr>
              <td valign="bottom" style="color:#7a8783;font-size:12px;line-height:1.5;">© ${year} Sendloom. All rights reserved.</td>
              <td align="right" valign="bottom" style="padding-left:12px;color:#15221f;font-size:14px;font-weight:700;line-height:1.2;white-space:nowrap;"><span style="color:#15221f;">Send</span><span style="color:#23a774;">loom</span></td>
            </tr></table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject: broadcast.subject, html, text };
}

export const resendProductUpdateMailer: ProductUpdateMailer = {
  isConfigured() {
    return Boolean(env.RESEND_API_KEY && env.DEFAULT_FROM_EMAIL);
  },

  async send(input) {
    if (!env.RESEND_API_KEY || !env.DEFAULT_FROM_EMAIL) {
      return { status: "retryable", errorCode: "RESEND_NOT_CONFIGURED", stopRun: true };
    }
    const rendered = renderProductUpdateEmail({ broadcast: input.broadcast, appBaseUrl: env.APP_BASE_URL });

    try {
      const result = await new Resend(env.RESEND_API_KEY).emails.send(
        {
          from: `${env.DEFAULT_FROM_NAME?.trim() || "Sendloom"} <${env.DEFAULT_FROM_EMAIL}>`,
          to: input.to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [
            { name: "category", value: "product-update" },
            { name: "broadcast_id", value: input.broadcast.id }
          ]
        },
        { idempotencyKey: input.idempotencyKey }
      );

      if (result.error) {
        const errorCode = result.error.name;
        return PERMANENT_PROVIDER_ERRORS.has(errorCode)
          ? { status: "permanent", errorCode }
          : { status: "retryable", errorCode, stopRun: true };
      }
      return { status: "accepted", providerMessageId: result.data.id };
    } catch (error) {
      console.error("[product-update-email] Resend delivery failed.", {
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
      return { status: "retryable", errorCode: "RESEND_NETWORK_ERROR", stopRun: true };
    }
  }
};
