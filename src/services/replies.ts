import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { listGmailReplyCandidates, listGmailThreadMessageIds, normalizeMessageId } from "@/lib/gmail";
import { refreshGoogleAccessToken } from "@/lib/google";
import { getRedis } from "@/lib/redis";
import { syncRunCounts } from "@/services/campaigns";

const REPLY_SYNC_MIN_INTERVAL_MS = 3 * 60_000;
const REPLY_SYNC_FORCED_MIN_INTERVAL_MS = 30_000;
const REPLY_SYNC_LOCK_TTL_SECONDS = 2 * 60;
const REPLY_SYNC_OVERLAP_MS = 15 * 60_000;
const INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
const RECIPIENT_LOOKBACK_MS = 90 * 24 * 60 * 60_000;
const DEFAULT_MAX_SENDERS = 10;
const DEFAULT_MAX_MESSAGES_PER_SENDER = 50;

type SenderSyncCandidate = {
  id: string;
  oauthRefreshToken: string | null;
  lastReplySyncAt: Date | null;
};

type ReplySyncResult = {
  repliesStored: number;
  sendersChecked: number;
  sendersFailed: number;
};

type CandidateRecipientJob = {
  id: string;
  campaignRunId: string;
  providerMessageId: string | null;
  repliedAt: Date | null;
  replyCount: number;
};

function isDuplicateRecordError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function getReplySyncStart(lastReplySyncAt: Date | null) {
  if (!lastReplySyncAt) {
    return new Date(Date.now() - INITIAL_LOOKBACK_MS);
  }

  return new Date(lastReplySyncAt.getTime() - REPLY_SYNC_OVERLAP_MS);
}

async function withSenderSyncLock<T>(senderId: string, callback: () => Promise<T>) {
  const redis = getRedis();
  const key = `sendloom:reply-sync:${senderId}`;
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const acquired = await redis.set(key, token, "EX", REPLY_SYNC_LOCK_TTL_SECONDS, "NX");

  if (acquired !== "OK") {
    return null;
  }

  try {
    return await callback();
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token
    );
  }
}

async function listSenderCandidates(maxSenders: number) {
  const cutoff = new Date(Date.now() - REPLY_SYNC_MIN_INTERVAL_MS);

  return prisma.senderProfile.findMany({
    where: {
      provider: "google_oauth",
      oauthRefreshToken: {
        not: null
      },
      campaigns: {
        some: {
          runs: {
            some: {
              recipientJobs: {
                some: {
                  providerMessageId: {
                    not: null
                  }
                }
              }
            }
          }
        }
      },
      OR: [
        {
          lastReplySyncAt: null
        },
        {
          lastReplySyncAt: {
            lte: cutoff
          }
        }
      ]
    },
    select: {
      id: true,
      oauthRefreshToken: true,
      lastReplySyncAt: true
    },
    orderBy: [{ lastReplySyncAt: "asc" }, { updatedAt: "desc" }],
    take: maxSenders
  });
}

async function getSenderSyncCandidate(senderId: string) {
  return prisma.senderProfile.findFirst({
    where: {
      id: senderId,
      provider: "google_oauth",
      oauthRefreshToken: {
        not: null
      }
    },
    select: {
      id: true,
      oauthRefreshToken: true,
      lastReplySyncAt: true
    }
  });
}

async function listCandidateRecipientJobs(senderProfileId: string) {
  const earliestCreatedAt = new Date(Date.now() - RECIPIENT_LOOKBACK_MS);

  const jobs = await prisma.recipientJob.findMany({
    where: {
      providerMessageId: {
        not: null
      },
      createdAt: {
        gte: earliestCreatedAt
      },
      campaignRun: {
        campaign: {
          senderProfileId
        }
      }
    },
    select: {
      id: true,
      campaignRunId: true,
      providerMessageId: true,
      repliedAt: true,
      replyCount: true
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 5_000
  });

  const jobsByMessageId = new Map<string, CandidateRecipientJob>();
  for (const job of jobs) {
    const normalizedId = normalizeMessageId(job.providerMessageId);
    if (!normalizedId || jobsByMessageId.has(normalizedId)) {
      continue;
    }

    jobsByMessageId.set(normalizedId, job);
  }

  return jobsByMessageId;
}

async function syncSenderReplies(sender: SenderSyncCandidate, maxMessages: number) {
  const refreshToken = sender.oauthRefreshToken;
  if (!refreshToken) {
    return 0;
  }

  const lockResult = await withSenderSyncLock(sender.id, async () => {
    const startedAt = new Date();
    try {
      const accessToken = await refreshGoogleAccessToken(refreshToken);
      const replies = await listGmailReplyCandidates({
        accessToken: accessToken.access_token,
        after: getReplySyncStart(sender.lastReplySyncAt),
        maxResults: maxMessages
      });
      const threadMessageIdsCache = new Map<string, string[]>();
      let matchedReplyCount = 0;
      let unmatchedReplyCount = 0;

      const messageIds = replies.map((reply) => reply.gmailMessageId);
      const existingReplies = messageIds.length
        ? await prisma.inboundReply.findMany({
            where: {
              gmailMessageId: {
                in: messageIds
              }
            },
            select: {
              gmailMessageId: true
            }
          })
        : [];

      const existingMessageIds = new Set(existingReplies.map((reply) => reply.gmailMessageId));
      const recipientJobsByMessageId = await listCandidateRecipientJobs(sender.id);
      const touchedRunIds = new Set<string>();
      let repliesStored = 0;

      for (const reply of replies) {
        if (existingMessageIds.has(reply.gmailMessageId)) {
          continue;
        }

        let matchedJob = reply.referenceMessageIds
          .map((messageId) => recipientJobsByMessageId.get(messageId))
          .find((entry): entry is CandidateRecipientJob => Boolean(entry));

        if (!matchedJob && reply.gmailThreadId) {
          let threadMessageIds = threadMessageIdsCache.get(reply.gmailThreadId);
          if (!threadMessageIds) {
            threadMessageIds = await listGmailThreadMessageIds({
              accessToken: accessToken.access_token,
              threadId: reply.gmailThreadId
            });
            threadMessageIdsCache.set(reply.gmailThreadId, threadMessageIds);
          }

          matchedJob = threadMessageIds
            .map((messageId) => recipientJobsByMessageId.get(messageId))
            .find((entry): entry is CandidateRecipientJob => Boolean(entry));
        }

        if (!matchedJob) {
          unmatchedReplyCount += 1;
          continue;
        }

        matchedReplyCount += 1;

        try {
          await prisma.$transaction(async (tx) => {
            await tx.inboundReply.create({
              data: {
                senderProfileId: sender.id,
                recipientJobId: matchedJob.id,
                gmailMessageId: reply.gmailMessageId,
                gmailThreadId: reply.gmailThreadId ?? null,
                fromEmail: reply.fromEmail ?? null,
                subject: reply.subject ?? null,
                snippet: reply.snippet ?? null,
                receivedAt: reply.receivedAt,
                payload: {
                  referenceMessageIds: reply.referenceMessageIds
                }
              }
            });

            const nextReplyCount = matchedJob.replyCount + 1;
            const nextRepliedAt =
              matchedJob.repliedAt && matchedJob.repliedAt > reply.receivedAt ? matchedJob.repliedAt : reply.receivedAt;

            await tx.recipientJob.update({
              where: {
                id: matchedJob.id
              },
              data: {
                replyCount: nextReplyCount,
                repliedAt: nextRepliedAt
              }
            });

            matchedJob.replyCount = nextReplyCount;
            matchedJob.repliedAt = nextRepliedAt;
          });
        } catch (error) {
          if (isDuplicateRecordError(error)) {
            continue;
          }

          throw error;
        }

        touchedRunIds.add(matchedJob.campaignRunId);
        existingMessageIds.add(reply.gmailMessageId);
        repliesStored += 1;
      }

      if (replies.length || repliesStored || unmatchedReplyCount) {
        console.info("[reply-sync] Processed Gmail replies.", {
          senderId: sender.id,
          repliesFetched: replies.length,
          repliesMatched: matchedReplyCount,
          repliesStored,
          unmatchedReplies: unmatchedReplyCount
        });
      }

      for (const runId of touchedRunIds) {
        await syncRunCounts(runId);
      }

      await prisma.senderProfile.update({
        where: {
          id: sender.id
        },
        data: {
          lastReplySyncAt: startedAt,
          lastReplySyncError: null
        }
      });

      return repliesStored;
    } catch (error) {
      await prisma.senderProfile.update({
        where: {
          id: sender.id
        },
        data: {
          lastReplySyncAt: startedAt,
          lastReplySyncError: error instanceof Error ? error.message.slice(0, 500) : "reply_sync_failed"
        }
      });

      throw error;
    }
  });

  return lockResult ?? 0;
}

export async function syncConnectedSenderReplies(args: { maxSenders?: number; maxMessagesPerSender?: number } = {}) {
  const senders = await listSenderCandidates(args.maxSenders ?? DEFAULT_MAX_SENDERS);
  const result: ReplySyncResult = {
    repliesStored: 0,
    sendersChecked: 0,
    sendersFailed: 0
  };

  for (const sender of senders) {
    result.sendersChecked += 1;
    try {
      result.repliesStored += await syncSenderReplies(sender, args.maxMessagesPerSender ?? DEFAULT_MAX_MESSAGES_PER_SENDER);
    } catch {
      result.sendersFailed += 1;
    }
  }

  return result;
}

export async function syncRepliesForSenderProfile(
  senderId: string,
  args: { force?: boolean; maxMessages?: number } = {}
) {
  const sender = await getSenderSyncCandidate(senderId);
  if (!sender) {
    return 0;
  }

  const freshnessWindowMs = args.force ? REPLY_SYNC_FORCED_MIN_INTERVAL_MS : REPLY_SYNC_MIN_INTERVAL_MS;
  const cutoff = new Date(Date.now() - freshnessWindowMs);
  if (sender.lastReplySyncAt && sender.lastReplySyncAt > cutoff) {
    return 0;
  }

  return syncSenderReplies(sender, args.maxMessages ?? DEFAULT_MAX_MESSAGES_PER_SENDER);
}
