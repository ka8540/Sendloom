import nodemailer from "nodemailer";

import { env } from "@/lib/env";

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

function createGmailTransport(sender: SenderAuth) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment.");
  }

  if (!sender.oauthRefreshToken) {
    throw new Error("This sender is not connected to Google. Reconnect the Gmail account and try again.");
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
}

export function isGmailDailyLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /daily user sending limit exceeded|550-5\.4\.5|550 5\.4\.5/i.test(message);
}
