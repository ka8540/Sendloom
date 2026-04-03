import nodemailer from "nodemailer";

import { env } from "@/lib/env";

export const GMAIL_RECONNECT_ERROR =
  "This Gmail sender needs to be reconnected. Google says its access expired or was revoked.";

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
};

const GMAIL_RECONNECT_PATTERNS = [
  "invalid_grant",
  "token has been expired or revoked",
  "token has been revoked",
  "refresh token",
  "invalid credentials"
] as const;

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

function createGmailTransport(sender: SenderAuth) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment.");
  }

  if (!sender.oauthRefreshToken) {
    throw new Error(GMAIL_RECONNECT_ERROR);
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: sender.fromEmail,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken: sender.oauthRefreshToken
    }
  });
}

export async function sendEmail(args: SendArgs) {
  if (env.MAIL_PROVIDER === "resend") {
    throw new Error("Resend is disabled for this local setup. Switch MAIL_PROVIDER or update the provider implementation.");
  }

  const transport = createGmailTransport(args.sender);
  try {
    const response = await transport.sendMail({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      attachments: args.attachments?.map((attachment) => {
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
      })
    });

    return {
      data: {
        id: response.messageId
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
