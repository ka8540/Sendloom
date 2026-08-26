import { SystemNoticeType } from "@prisma/client";
import { Resend } from "resend";

import { env } from "@/lib/env";
import { SYSTEM_NOTICE_TYPE_LABELS } from "@/lib/system-notices";

export type SystemNoticeEmailInput = {
  id?: string;
  type: SystemNoticeType;
  subject: string;
  title: string;
  message: string;
  affectedArea: string | null;
  scheduledSendAt: Date | null;
  impactStartsAt: Date | null;
  impactEndsAt: Date | null;
  timeZone: string;
};

export type SystemNoticeDeliveryResult =
  | { status: "accepted"; providerMessageId: string }
  | { status: "retryable"; errorCode: string; stopRun: true }
  | { status: "permanent"; errorCode: string };

export type SystemNoticeMailer = {
  isConfigured(): boolean;
  send(input: {
    to: string;
    notice: SystemNoticeEmailInput & { id: string };
    idempotencyKey: string;
  }): Promise<SystemNoticeDeliveryResult>;
};

const PERMANENT_PROVIDER_ERRORS = new Set(["invalid_parameter", "validation_error"]);

const EXPECTATION_COPY: Record<SystemNoticeType, string> = {
  PLANNED_MAINTENANCE:
    "During this window, some actions may take longer than usual and parts of Sendloom may be temporarily unavailable.",
  DEGRADED_PERFORMANCE:
    "You may experience slower response times or intermittent delays while we work to restore normal performance.",
  SERVICE_DISRUPTION:
    "Some Sendloom features may be temporarily unavailable while we work to restore normal service.",
  RESOLVED: "Service has recovered. You can continue using Sendloom normally.",
  GENERAL: "We are sharing this operational update so you know what to expect while using Sendloom."
};

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

function formatInstant(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(date);
}

export function formatSystemNoticeImpactWindow(input: Pick<SystemNoticeEmailInput, "impactStartsAt" | "impactEndsAt" | "timeZone">) {
  const { impactStartsAt: start, impactEndsAt: end, timeZone } = input;
  if (!start && !end) return null;

  const dateOptions: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", year: "numeric" };
  const timeOptions: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZoneName: "short" };

  if (start && end) {
    const startDay = formatInstant(start, timeZone, dateOptions);
    const endDay = formatInstant(end, timeZone, dateOptions);
    const startTime = formatInstant(start, timeZone, timeOptions);
    const endTime = formatInstant(end, timeZone, timeOptions);
    return startDay === endDay
      ? `${startDay}\n${startTime} – ${endTime}\n${timeZone}`
      : `${startDay}, ${startTime} – ${endDay}, ${endTime}\n${timeZone}`;
  }

  const label = start ? "Begins" : "Expected through";
  const instant = start ?? end!;
  return `${label} ${formatInstant(instant, timeZone, { ...dateOptions, ...timeOptions })}\n${timeZone}`;
}

/** Pure preview renderer. It returns content only and cannot create delivery state. */
export function renderSystemNoticeEmail(input: { notice: SystemNoticeEmailInput; appBaseUrl: string }) {
  const notice = input.notice;
  const typeLabel = SYSTEM_NOTICE_TYPE_LABELS[notice.type];
  const impactWindow = formatSystemNoticeImpactWindow(notice);
  const logoUrl = new URL("/icon-192.png", input.appBaseUrl).toString();
  const year = new Date().getUTCFullYear();
  const reassurance =
    notice.type === SystemNoticeType.RESOLVED
      ? "No action is required. Thank you for your patience."
      : "No action is required. We will work to restore normal service as quickly as possible. Thank you for your patience.";

  const text = [
    "Sendloom",
    "",
    typeLabel.toUpperCase(),
    "",
    notice.title,
    "",
    notice.message,
    ...(notice.affectedArea ? ["", "AFFECTED AREA", notice.affectedArea] : []),
    ...(impactWindow ? ["", "IMPACT WINDOW", impactWindow] : []),
    "",
    "What to expect",
    EXPECTATION_COPY[notice.type],
    "",
    reassurance,
    "",
    "------------------------------------------------",
    "",
    "You're receiving this service notice because you have a Sendloom account.",
    `© ${year} Sendloom. All rights reserved.`
  ].join("\n");

  const detailRows = [
    notice.affectedArea
      ? { label: "Affected area", value: notice.affectedArea }
      : null,
    impactWindow ? { label: "Impact window", value: impactWindow } : null
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  const detailsHtml = detailRows.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin-top:22px;border:1px solid #dfe7e4;border-collapse:separate;border-radius:14px;background:#f8fbfa;">
        ${detailRows
          .map(
            (item, index) => `<tr>
              <td style="padding:15px 17px;${index ? "border-top:1px solid #dfe7e4;" : ""}">
                <p style="margin:0 0 4px;color:#157c5a;font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;">${escapeHtml(item.label)}</p>
                <p style="margin:0;color:#263632;font-size:14px;font-weight:650;line-height:1.55;">${htmlWithLineBreaks(item.value)}</p>
              </td>
            </tr>`
          )
          .join("")}
      </table>`
    : "";

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
                    <td valign="middle" style="padding-right:10px;"><img src="${escapeHtml(logoUrl)}" width="40" height="40" alt="Sendloom" style="display:block;width:40px;height:40px;border:0;border-radius:10px;outline:none;text-decoration:none;"></td>
                    <td valign="middle" style="color:#15221f;font-size:23px;font-weight:750;line-height:1;letter-spacing:-0.03em;white-space:nowrap;"><span style="color:#15221f;">Send</span><span style="color:#23a774;">loom</span></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="border-top:1px solid #e4efeb;border-bottom:1px solid #e4efeb;background:#edf8f4;padding:25px 30px 28px;">
                <span style="display:inline-block;border:1px solid #cde8de;border-radius:999px;background:#ffffff;padding:7px 13px;color:#157c5a;font-size:11px;font-weight:800;line-height:1;letter-spacing:0.11em;text-transform:uppercase;">${escapeHtml(typeLabel)}</span>
                <h1 style="margin:16px 0 0;color:#15221f;font-size:29px;font-weight:750;line-height:1.2;letter-spacing:-0.025em;">${escapeHtml(notice.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 30px 10px;">
                <p style="margin:0;color:#40534e;font-size:15px;line-height:1.7;">${htmlWithLineBreaks(notice.message)}</p>
                ${detailsHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:14px 30px 28px;">
                <h2 style="margin:0 0 8px;color:#15221f;font-size:17px;font-weight:750;line-height:1.4;">What to expect</h2>
                <p style="margin:0;color:#536460;font-size:14px;line-height:1.65;">${escapeHtml(EXPECTATION_COPY[notice.type])}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin-top:20px;border:1px solid #d7ebe4;border-collapse:separate;border-radius:12px;background:#f4faf8;">
                  <tr>
                    <td width="34" valign="middle" style="width:34px;padding:15px 0 15px 17px;color:#157c5a;font-size:18px;font-weight:800;">&#10003;</td>
                    <td style="padding:14px 17px 14px 10px;color:#40534e;font-size:13px;line-height:1.6;">${escapeHtml(reassurance)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #dfe7e4;background:#fbfcfc;padding:20px 28px 24px;">
                <p style="margin:0;color:#7a8783;font-size:12px;line-height:1.6;">You're receiving this service notice because you have a Sendloom account.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin-top:10px;"><tr>
                  <td valign="bottom" style="color:#7a8783;font-size:12px;line-height:1.5;">© ${year} Sendloom. All rights reserved.</td>
                  <td align="right" valign="bottom" style="padding-left:12px;color:#15221f;font-size:14px;font-weight:700;line-height:1.2;white-space:nowrap;"><span style="color:#15221f;">Send</span><span style="color:#23a774;">loom</span></td>
                </tr></table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: notice.subject, html, text, typeLabel, impactWindow };
}

export const resendSystemNoticeMailer: SystemNoticeMailer = {
  isConfigured() {
    return Boolean(env.RESEND_API_KEY && env.DEFAULT_FROM_EMAIL);
  },

  async send(input) {
    if (!env.RESEND_API_KEY || !env.DEFAULT_FROM_EMAIL) {
      return { status: "retryable", errorCode: "RESEND_NOT_CONFIGURED", stopRun: true };
    }
    const rendered = renderSystemNoticeEmail({ notice: input.notice, appBaseUrl: env.APP_BASE_URL });

    try {
      const result = await new Resend(env.RESEND_API_KEY).emails.send(
        {
          from: `${env.DEFAULT_FROM_NAME?.trim() || "Sendloom"} <${env.DEFAULT_FROM_EMAIL}>`,
          to: input.to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [
            { name: "category", value: "system-notice" },
            { name: "notice_type", value: input.notice.type.toLowerCase() },
            { name: "notice_id", value: input.notice.id }
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
      console.error("[system-notice-email] Resend delivery failed.", {
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
      return { status: "retryable", errorCode: "RESEND_NETWORK_ERROR", stopRun: true };
    }
  }
};
