import MailComposer from "nodemailer/lib/mail-composer";

import { env } from "@/lib/env";
import { refreshGoogleAccessToken } from "@/lib/google";

export const GMAIL_RECONNECT_ERROR =
  "This Gmail sender needs to be reconnected. Google says its access expired, was revoked, or is missing the required send permission.";

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

async function buildRawGmailMessage(args: SendArgs) {
  const composer = new MailComposer({
    from: args.from,
    to: args.to,
    subject: args.subject,
    html: args.html,
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
    throw new Error(payload.error?.message || "Could not send Gmail message.");
  }

  return payload;
}

export async function sendEmail(args: SendArgs) {
  if (env.MAIL_PROVIDER === "resend") {
    throw new Error("Resend is disabled for this local setup. Switch MAIL_PROVIDER or update the provider implementation.");
  }

  try {
    const accessToken = await getGoogleAccessToken(args.sender);
    const rawMessage = await buildRawGmailMessage(args);
    const response = await sendGmailMessage(rawMessage, accessToken);

    return {
      data: {
        id: response.id
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
