import MailComposer from "nodemailer/lib/mail-composer";

import { env } from "@/lib/env";
import type { FailureCode } from "@/lib/failures";
import {
  buildGmailApiFailureDiagnostic,
  GmailSendError,
  isGmailDailyLimitLikeError,
  isGmailRateLimitLikeError,
  isGmailTemporaryLikeError,
  type GoogleApiErrorBody
} from "@/lib/gmail-errors";
import { normalizeGoogleApiErrorMessage, refreshGoogleAccessToken } from "@/lib/google";
import { getObjectBuffer } from "@/lib/storage";

export const GMAIL_RECONNECT_ERROR =
  "This Gmail sender needs to be reconnected. Google says its access expired, was revoked, or is missing the required send permission.";
export const GMAIL_SEND_USER_ERROR = "Couldn't send the email right now. Please try again.";
export const GMAIL_SEND_RATE_LIMIT_USER_ERROR =
  "Gmail is rate limiting sends right now. Sendloom will retry automatically.";
export const GMAIL_SEND_TEMPORARY_USER_ERROR =
  "Gmail is temporarily unavailable for this send. Sendloom will retry automatically.";
export const GMAIL_SEND_DAILY_LIMIT_USER_ERROR =
  "Daily Gmail safety limit reached. Sending resumes automatically when the safety window resets.";
export const GMAIL_SEND_REJECTED_USER_ERROR = "Gmail rejected this recipient.";

const GOOGLE_GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

type SenderAuth = {
  fromEmail: string;
  oauthRefreshToken?: string | null;
};

export type EmailAttachment = {
  fileName: string;
  storagePath?: string;
  contentBase64?: string;
  contentType?: string | null;
  // Set on snapshots written after attachment dedupe shipped; legacy
  // snapshots carry only storagePath and must keep working.
  assetId?: string;
  sizeBytes?: number;
};

type SendArgs = {
  from: string;
  to: string;
  subject: string;
  html: string;
  sender: SenderAuth;
  attachments?: EmailAttachment[];
};

const GMAIL_RECONNECT_PATTERNS = [
  "invalid_grant",
  "token has been expired or revoked",
  "token has been revoked",
  "refresh token",
  "invalid credentials",
  "insufficient authentication scopes",
  "insufficientpermissions"
] as const;

type GmailSendApiResponse = {
  id?: string;
  error?: GoogleApiErrorBody;
};

export function isGmailReconnectError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);

  const normalized = message.toLowerCase();
  return GMAIL_RECONNECT_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function getUserSafeGmailSendError(error: unknown, failureCode?: FailureCode) {
  if (isGmailReconnectError(error)) {
    return GMAIL_RECONNECT_ERROR;
  }

  if (failureCode === "GMAIL_RATE_LIMITED" || isGmailRateLimitLikeError(error)) {
    return isGmailDailyLimitError(error) ? GMAIL_SEND_DAILY_LIMIT_USER_ERROR : GMAIL_SEND_RATE_LIMIT_USER_ERROR;
  }

  if (failureCode === "GMAIL_TEMPORARY_FAILURE" || isGmailTemporaryLikeError(error)) {
    return GMAIL_SEND_TEMPORARY_USER_ERROR;
  }

  if (failureCode === "GMAIL_SEND_REJECTED") {
    return GMAIL_SEND_REJECTED_USER_ERROR;
  }

  return GMAIL_SEND_USER_ERROR;
}

async function getAttachmentPayload(attachment: EmailAttachment) {
  if (attachment.contentBase64) {
    return {
      filename: attachment.fileName,
      content: Buffer.from(attachment.contentBase64, "base64"),
      contentType: attachment.contentType ?? undefined
    };
  }

  if (!attachment.storagePath) {
    throw new Error(`Attachment ${attachment.fileName} is missing storage information.`);
  }

  return {
    filename: attachment.fileName,
    content: await getObjectBuffer("attachments", attachment.storagePath),
    contentType: attachment.contentType ?? undefined
  };
}

/**
 * Generate the RFC Message-ID for an outgoing message ourselves (instead of
 * letting MailComposer invent one we never see). Delivery-status notifications
 * reference this id, so storing it at send time gives bounce processing its
 * strongest correlation key.
 */
function generateRfcMessageId(fromEmail: string) {
  const domain = fromEmail.split("@")[1] || "sendloom.local";
  const unique = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
  return `<${unique}@${domain}>`;
}

async function buildRawGmailMessage(args: SendArgs, rfcMessageId: string) {
  const attachments = args.attachments
    ? await Promise.all(args.attachments.map(getAttachmentPayload))
    : undefined;

  const composer = new MailComposer({
    from: args.from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    messageId: rfcMessageId,
    attachments
  });

  const message = await new Promise<Buffer>((resolve, reject) => {
    composer.compile().build((error, value) => {
      if (error) {
        reject(error);
        return;
      }

      if (!value) {
        reject(new Error("Could not build Gmail message."));
        return;
      }

      resolve(value);
    });
  });

  return message.toString("base64url");
}

async function getGoogleAccessToken(sender: SenderAuth) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment.");
  }

  if (!sender.oauthRefreshToken) {
    throw new Error(GMAIL_RECONNECT_ERROR);
  }

  const tokens = await refreshGoogleAccessToken(sender.oauthRefreshToken);
  return tokens.access_token;
}

async function sendGmailMessage(raw: string, accessToken: string) {
  const response = await fetch(GOOGLE_GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw })
  });

  const payload = (await response.json().catch(() => ({}))) as GmailSendApiResponse;

  if (!response.ok || !payload.id) {
    const fallbackMessage = "Could not send Gmail message.";
    const diagnostic = buildGmailApiFailureDiagnostic(payload.error, {
      httpStatus: response.status,
      retryAfter: response.headers.get("retry-after"),
      fallbackMessage
    });
    const message = normalizeGoogleApiErrorMessage(diagnostic.message || fallbackMessage);
    throw new GmailSendError(message, diagnostic);
  }

  return payload;
}

export async function sendEmail(args: SendArgs) {
  if (env.MAIL_PROVIDER === "resend") {
    throw new Error("Resend is disabled for this local setup. Switch MAIL_PROVIDER or update the provider implementation.");
  }

  try {
    const accessToken = await getGoogleAccessToken(args.sender);
    const rfcMessageId = generateRfcMessageId(args.sender.fromEmail);
    const rawMessage = await buildRawGmailMessage(args, rfcMessageId);
    const response = await sendGmailMessage(rawMessage, accessToken);

    return {
      data: {
        id: response.id,
        rfcMessageId
      }
    };
  } catch (error) {
    if (isGmailReconnectError(error)) {
      throw new Error(GMAIL_RECONNECT_ERROR);
    }

    throw error;
  }
}

export function isGmailDailyLimitError(error: unknown) {
  return isGmailDailyLimitLikeError(error);
}
