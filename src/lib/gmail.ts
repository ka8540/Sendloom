import { normalizeGoogleApiErrorMessage } from "@/lib/google";

const GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_METADATA_CONCURRENCY = 5;

type GmailMessageRef = {
  id: string;
  threadId?: string;
};

type GmailListResponse = {
  messages?: GmailMessageRef[];
  nextPageToken?: string;
};

type GmailThreadResponse = {
  messages?: GmailMessageRef[];
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

async function fetchGmailMessageMetadataBatch(accessToken: string, messages: GmailMessageRef[]) {
  const details: GmailMessageResponse[] = [];

  for (let index = 0; index < messages.length; index += GMAIL_METADATA_CONCURRENCY) {
    const batch = messages.slice(index, index + GMAIL_METADATA_CONCURRENCY);
    details.push(...(await Promise.all(batch.map((message) => fetchGmailMessageMetadata(accessToken, message.id)))));
  }

  return details;
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

  const details = await fetchGmailMessageMetadataBatch(args.accessToken, messages);

  return details
    .map((message) => mapReplyCandidate(message))
    .filter((message): message is GmailReplyCandidate => Boolean(message))
    .sort((left, right) => left.receivedAt.getTime() - right.receivedAt.getTime());
}

export async function listGmailThreadMessageIds(args: { accessToken: string; threadId: string }) {
  const url = new URL(`${GMAIL_API_BASE_URL}/threads/${args.threadId}`);
  url.searchParams.set("format", "minimal");

  const payload = await fetchGmailJson<GmailThreadResponse>(args.accessToken, url);
  return (payload.messages ?? [])
    .map((message) => normalizeMessageId(message.id))
    .filter((messageId): messageId is string => Boolean(messageId));
}

// ---------------------------------------------------------------------------
// Bounce monitoring: mailbox watch + history + delivery-status candidates.
// ---------------------------------------------------------------------------

export type GmailWatchResult = {
  historyId: string;
  /** Watch expiration (Gmail returns epoch millis as a string). */
  expiresAt: Date;
};

/**
 * Register (or refresh) the mailbox watch that publishes change notifications
 * to the configured Pub/Sub topic. Watching INBOX only — bounces land there —
 * keeps the notification volume and the mailbox surface minimal.
 */
export async function registerGmailWatch(args: { accessToken: string; topicName: string }): Promise<GmailWatchResult> {
  const response = await fetch(`${GMAIL_API_BASE_URL}/watch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      topicName: args.topicName,
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE"
    })
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(normalizeGoogleApiErrorMessage(payload || "Gmail watch registration failed."));
  }

  const payload = (await response.json()) as { historyId?: string; expiration?: string };
  if (!payload.historyId || !payload.expiration) {
    throw new Error("Gmail watch registration returned no history id.");
  }

  return {
    historyId: payload.historyId,
    expiresAt: new Date(Number.parseInt(payload.expiration, 10))
  };
}

type GmailHistoryResponse = {
  history?: Array<{
    id?: string;
    messagesAdded?: Array<{ message?: GmailMessageRef & { labelIds?: string[] } }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
};

export class GmailHistoryExpiredError extends Error {
  constructor() {
    super("Gmail history id is out of date.");
    this.name = "GmailHistoryExpiredError";
  }
}

/**
 * List message ids ADDED to the mailbox since the stored history id. Only
 * message-added records are considered (label changes are irrelevant here).
 * Throws GmailHistoryExpiredError on a 404 so callers run the bounded
 * recovery sync instead of failing.
 */
export async function listGmailHistoryMessageIds(args: {
  accessToken: string;
  startHistoryId: string;
  maxMessages?: number;
}): Promise<{ messageIds: string[]; latestHistoryId: string }> {
  const maxMessages = args.maxMessages ?? 200;
  const messageIds = new Set<string>();
  let latestHistoryId = args.startHistoryId;
  let nextPageToken: string | undefined;

  do {
    const url = new URL(`${GMAIL_API_BASE_URL}/history`);
    url.searchParams.set("startHistoryId", args.startHistoryId);
    url.searchParams.set("historyTypes", "messageAdded");
    url.searchParams.set("maxResults", "100");
    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${args.accessToken}` }
    });

    if (response.status === 404) {
      throw new GmailHistoryExpiredError();
    }
    if (!response.ok) {
      const payload = await response.text();
      throw new Error(normalizeGoogleApiErrorMessage(payload || "Gmail history request failed."));
    }

    const payload = (await response.json()) as GmailHistoryResponse;
    for (const entry of payload.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        if (added.message?.id) {
          messageIds.add(added.message.id);
        }
      }
    }
    if (payload.historyId) {
      latestHistoryId = payload.historyId;
    }
    nextPageToken = payload.nextPageToken;
  } while (nextPageToken && messageIds.size < maxMessages);

  return { messageIds: [...messageIds].slice(0, maxMessages), latestHistoryId };
}

/** Current mailbox history id (used to initialise/repair the stored position). */
export async function getGmailProfileHistoryId(accessToken: string): Promise<string> {
  const payload = await fetchGmailJson<{ historyId?: string }>(accessToken, `${GMAIL_API_BASE_URL}/profile`);
  if (!payload.historyId) {
    throw new Error("Gmail profile returned no history id.");
  }
  return payload.historyId;
}

/**
 * Lightweight metadata for DSN filtering — only the headers needed to decide
 * whether a message is a delivery-status notification. Never bodies.
 */
export async function fetchGmailDsnFilterMetadata(accessToken: string, messageId: string) {
  const url = new URL(`${GMAIL_API_BASE_URL}/messages/${messageId}`);
  url.searchParams.set("format", "metadata");
  for (const header of ["From", "Subject", "Content-Type", "Auto-Submitted", "X-Failed-Recipients"]) {
    url.searchParams.append("metadataHeaders", header);
  }
  return fetchGmailJson<GmailMessageResponse>(accessToken, url);
}

/** Full (Gmail-parsed) message payload for DSN parsing. */
export async function fetchGmailMessageFull(accessToken: string, messageId: string) {
  const url = new URL(`${GMAIL_API_BASE_URL}/messages/${messageId}`);
  url.searchParams.set("format", "full");
  return fetchGmailJson<Record<string, unknown>>(accessToken, url);
}

/**
 * Bounded search for likely delivery-status messages (recovery + one-time
 * backfill). The query narrows to automated failure senders/subjects within a
 * limited window; per-message DSN filtering still applies afterwards.
 */
export async function listGmailDsnCandidateIds(args: {
  accessToken: string;
  newerThanDays: number;
  maxResults: number;
}): Promise<string[]> {
  const messages: GmailMessageRef[] = [];
  let nextPageToken: string | undefined;
  const query = `(from:mailer-daemon OR from:postmaster OR subject:"Delivery Status Notification" OR subject:Undeliverable) newer_than:${Math.max(1, Math.floor(args.newerThanDays))}d`;

  do {
    const url = new URL(`${GMAIL_API_BASE_URL}/messages`);
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", String(Math.min(100, args.maxResults - messages.length)));
    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }
    const payload = await fetchGmailJson<GmailListResponse>(args.accessToken, url);
    messages.push(...(payload.messages ?? []));
    nextPageToken = payload.nextPageToken;
  } while (nextPageToken && messages.length < args.maxResults);

  return messages.slice(0, args.maxResults).map((message) => message.id);
}
