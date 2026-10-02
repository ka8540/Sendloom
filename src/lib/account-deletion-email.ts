import { Resend } from "resend";
import { env } from "@/lib/env";

export type DeletionEmailKind = "ACCOUNT_DELETED" | "REQUEST_RECEIVED" | "FULL_DELETION_COMPLETE";

const messages: Record<DeletionEmailKind, { subject: string; headline: string; paragraphs: string[] }> = {
  ACCOUNT_DELETED: {
    subject: "Sorry to see you go 💚",
    headline: "Thanks for spending some time with Sendloom.",
    paragraphs: [
      "Your Sendloom account has been deleted successfully.",
      "We're sad to see you go, but we're grateful you chose Sendloom to be part of your outreach journey.",
      "If you ever decide to come back, our doors are always open. You can create a new account anytime and start fresh.",
      "Thanks for choosing Sendloom, even if it was only for a little while.",
    ],
  },
  REQUEST_RECEIVED: {
    subject: "We've received your deletion request",
    headline: "Sorry to see you go 💚",
    paragraphs: [
      "We've received your request to delete your Sendloom account and outreach data.",
      "Your request is pending administrative review. Permanent outreach-data deletion has not completed yet.",
      "We're grateful you chose Sendloom for your outreach. If you return in the future, our doors will be open.",
    ],
  },
  FULL_DELETION_COMPLETE: {
    subject: "Your Sendloom deletion is complete",
    headline: "Your deletion is complete",
    paragraphs: [
      "Your requested Sendloom account and outreach-data deletion has been completed.",
      "Thank you again for using Sendloom. If our paths cross again someday, we'll be happy to have you back. 💚",
    ],
  },
};

export function renderDeletionEmail(kind: DeletionEmailKind) {
  const message = messages[kind];
  const text = ["Sendloom", "", message.headline, "", ...message.paragraphs.flatMap((p) => [p, ""]), "Take care,", "The Sendloom Team"].join("\n");
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3f6f8;color:#15221f;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border:1px solid #dfe7e4;border-radius:18px"><tr><td style="padding:30px 32px 12px;color:#157c5a;font-weight:750;font-size:18px">Sendloom</td></tr><tr><td style="padding:0 32px 32px"><h1 style="font-size:26px;line-height:1.25">${message.headline}</h1>${message.paragraphs.map((p) => `<p style="font-size:16px;line-height:1.6;color:#536460">${p.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</p>`).join("")}<p style="font-size:16px;line-height:1.6">Take care,<br>The Sendloom Team</p></td></tr></table></td></tr></table></body></html>`;
  return { subject: message.subject, html, text };
}

/** Idempotency is shared across retries of the same deletion event. */
export async function sendDeletionEmail(input: { to: string; kind: DeletionEmailKind; idempotencyKey: string }) {
  if (!env.RESEND_API_KEY || !env.DEFAULT_FROM_EMAIL) throw new Error("Deletion email is not configured.");
  const content = renderDeletionEmail(input.kind);
  const result = await new Resend(env.RESEND_API_KEY).emails.send({
    from: `${env.DEFAULT_FROM_NAME?.trim() || "Sendloom"} <${env.DEFAULT_FROM_EMAIL}>`,
    to: input.to,
    ...content,
  }, { idempotencyKey: input.idempotencyKey });
  if (result.error) throw new Error("Deletion email was not accepted.");
}
