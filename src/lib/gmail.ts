import { normalizeGoogleApiErrorMessage } from "@/lib/google";

const GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

type GmailMessageRef = {
  id: string;
  threadId?: string;
};

type GmailListResponse = {
  messages?: GmailMessageRef[];
  nextPageToken?: string;
};

type GmailHeader = {
  name: string;
  value: string;
};

type GmailMessageResponse = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: GmailHeader[];
  };
};

export type GmailReplyCandidate = {
  gmailMessageId: string;
  gmailThreadId?: string;
  fromEmail?: string | null;
  subject?: string | null;
  snippet?: string | null;
  receivedAt: Date;
  referenceMessageIds: string[];
};

function getHeader(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

export function normalizeMessageId(value?: string | null) {
  if (!value) {
    return null;
  }

  return value.replace(/[<>]/g, "").trim().toLowerCase() || null;
}

function parseEmailAddress(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
}

function extractMessageIds(value?: string | null) {
  if (!value) {
    return [];
  }

  const angleBracketMatches = value.match(/<[^>]+>/g);
  if (angleBracketMatches?.length) {
    return angleBracketMatches
      .map((entry) => normalizeMessageId(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  const normalized = normalizeMessageId(value);
  return normalized ? [normalized] : [];
}

async function fetchGmailJson<T>(accessToken: string, input: URL | string) {
  const response = await fetch(input, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(normalizeGoogleApiErrorMessage(payload || "Gmail API request failed."));
  }

  return (await response.json()) as T;
}

async function listGmailMessages(args: { accessToken: string; after: Date; maxResults: number }) {
  const messages: GmailMessageRef[] = [];
  let nextPageToken: string | undefined;

  do {
    const url = new URL(`${GMAIL_API_BASE_URL}/messages`);
    url.searchParams.set("labelIds", "INBOX");
    url.searchParams.set("maxResults", String(Math.min(100, args.maxResults - messages.length)));
    url.searchParams.set("q", `after:${Math.floor(args.after.getTime() / 1000)}`);

    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    const payload = await fetchGmailJson<GmailListResponse>(args.accessToken, url);
    messages.push(...(payload.messages ?? []));
    nextPageToken = payload.nextPageToken;
  } while (nextPageToken && messages.length < args.maxResults);

  return messages;
}

async function fetchGmailMessageMetadata(accessToken: string, messageId: string) {
  const url = new URL(`${GMAIL_API_BASE_URL}/messages/${messageId}`);
  url.searchParams.set("format", "metadata");
  url.searchParams.append("metadataHeaders", "From");
  url.searchParams.append("metadataHeaders", "Subject");
  url.searchParams.append("metadataHeaders", "Date");
  url.searchParams.append("metadataHeaders", "In-Reply-To");
  url.searchParams.append("metadataHeaders", "References");

  return fetchGmailJson<GmailMessageResponse>(accessToken, url);
}

function mapReplyCandidate(message: GmailMessageResponse): GmailReplyCandidate | null {
  const headers = message.payload?.headers;
  const references = [
    ...extractMessageIds(getHeader(headers, "In-Reply-To")),
    ...extractMessageIds(getHeader(headers, "References"))
  ];

  const uniqueReferences = [...new Set(references)];
  if (!uniqueReferences.length) {
    return null;
  }

  const internalDate = message.internalDate ? Number.parseInt(message.internalDate, 10) : NaN;

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    fromEmail: parseEmailAddress(getHeader(headers, "From")),
    subject: getHeader(headers, "Subject"),
    snippet: message.snippet ?? null,
    receivedAt: Number.isFinite(internalDate) ? new Date(internalDate) : new Date(),
    referenceMessageIds: uniqueReferences
  };
}

export async function listGmailReplyCandidates(args: { accessToken: string; after: Date; maxResults?: number }) {
  const messages = await listGmailMessages({
    accessToken: args.accessToken,
    after: args.after,
    maxResults: args.maxResults ?? 50
  });

  const details = await Promise.all(messages.map((message) => fetchGmailMessageMetadata(args.accessToken, message.id)));

  return details
    .map((message) => mapReplyCandidate(message))
    .filter((message): message is GmailReplyCandidate => Boolean(message))
    .sort((left, right) => left.receivedAt.getTime() - right.receivedAt.getTime());
}
