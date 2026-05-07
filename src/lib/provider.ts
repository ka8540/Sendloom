import crypto from "node:crypto";

import MailComposer from "nodemailer/lib/mail-composer";

import { env } from "@/lib/env";
import { normalizeGoogleApiErrorMessage, refreshGoogleAccessToken } from "@/lib/google";

export const GMAIL_RECONNECT_ERROR =
  "This Gmail sender needs to be reconnected. Google says its access expired, was revoked, or is missing the required send permission.";
export const GMAIL_SEND_USER_ERROR = "Couldn't send the email right now. Please try again.";
export const GMAIL_SEND_LIMIT_USER_ERROR = "Gmail sending is temporarily unavailable. Please try again later.";

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
};

type SendArgs = {
  from: string;
  to: string;
  subject: string;
  html: string;
  sender: SenderAuth;
  attachments?: EmailAttachment[];
  gmailThreadId?: string | null;
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
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
  threadId?: string;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
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

export function getUserSafeGmailSendError(error: unknown) {
  if (isGmailReconnectError(error)) {
    return GMAIL_RECONNECT_ERROR;
  }

  if (isGmailDailyLimitError(error)) {
    return GMAIL_SEND_LIMIT_USER_ERROR;
  }

  return GMAIL_SEND_USER_ERROR;
}

function getAttachmentPayload(attachment: EmailAttachment) {
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
    path: attachment.storagePath,
    contentType: attachment.contentType ?? undefined
  };
}

function getSenderDomain(sender: SenderAuth) {
  const domain = sender.fromEmail.split("@")[1]?.trim().toLowerCase();
  return domain && /^[a-z0-9.-]+$/i.test(domain) ? domain : "sendloom.local";
}

export function createMessageIdHeader(sender: SenderAuth) {
  return `<sendloom-${crypto.randomUUID()}@${getSenderDomain(sender)}>`;
}

async function buildRawGmailMessage(args: SendArgs) {
  const composer = new MailComposer({
    from: args.from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    messageId: args.messageIdHeader ?? undefined,
    inReplyTo: args.inReplyTo ?? undefined,
    references: args.references ?? undefined,
    attachments: args.attachments?.map(getAttachmentPayload)
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

async function sendGmailMessage(raw: string, accessToken: string, gmailThreadId?: string | null) {
  const response = await fetch(GOOGLE_GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      raw,
      ...(gmailThreadId ? { threadId: gmailThreadId } : {})
    })
  });

  const payload = (await response.json().catch(() => ({}))) as GmailSendApiResponse;

  if (!response.ok || !payload.id) {
    throw new Error(normalizeGoogleApiErrorMessage(payload.error?.message || "Could not send Gmail message."));
  }

  return payload;
}

export async function sendEmail(args: SendArgs) {
  if (env.MAIL_PROVIDER === "resend") {
    throw new Error("Resend is disabled for this local setup. Switch MAIL_PROVIDER or update the provider implementation.");
  }

  try {
    const accessToken = await getGoogleAccessToken(args.sender);
    const messageIdHeader = args.messageIdHeader ?? createMessageIdHeader(args.sender);
    const rawMessage = await buildRawGmailMessage({
      ...args,
      messageIdHeader
    });
    const response = await sendGmailMessage(rawMessage, accessToken, args.gmailThreadId);

    return {
      data: {
        id: response.id,
        threadId: response.threadId,
        messageIdHeader
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
  const message = error instanceof Error ? error.message : String(error);
  return /daily user sending limit exceeded|550-5\.4\.5|550 5\.4\.5/i.test(message);
}
