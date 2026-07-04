import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, tx } = vi.hoisted(() => {
  const transaction = {
    $executeRaw: vi.fn(),
    user: { findUniqueOrThrow: vi.fn() },
    campaign: { count: vi.fn(), update: vi.fn() },
    campaignRun: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn()
    }
  };
  return {
    tx: transaction,
    prismaMock: {
      $transaction: vi.fn(async (operation: (client: typeof transaction) => unknown) => operation(transaction))
    }
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  SequenceStorageLimitError,
  claimSequenceExecutionSlot,
  isSequenceConsumingExecutionSlot,
  promoteWaitingSequencesForUser,
  withSequenceCreationCapacity
} from "@/services/sequence-limits";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (operation) => operation(tx));
  tx.$executeRaw.mockResolvedValue(1);
  tx.user.findUniqueOrThrow.mockResolvedValue({ email: "person@example.com" });
});

describe("stored sequence enforcement", () => {
  it("allows sequence 50 and performs the create inside the user lock", async () => {
    tx.campaign.count.mockResolvedValue(49);
    const operation = vi.fn().mockResolvedValue("created");

    await expect(withSequenceCreationCapacity("user-1", operation)).resolves.toBe("created");
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledWith(tx);
  });

  it("blocks sequence 51 before invoking attachment/create work", async () => {
    tx.campaign.count.mockResolvedValue(50);
    const operation = vi.fn();

    await expect(withSequenceCreationCapacity("user-1", operation)).rejects.toBeInstanceOf(
      SequenceStorageLimitError
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it("does not cap the exempt owner", async () => {
    tx.user.findUniqueOrThrow.mockResolvedValue({ email: "  KUSH.AHIR2024@GMAIL.COM " });
    const operation = vi.fn().mockResolvedValue("created");

    await expect(withSequenceCreationCapacity("owner", operation)).resolves.toBe("created");
    expect(tx.campaign.count).not.toHaveBeenCalled();
  });
});

describe("execution slot enforcement", () => {
  it("claims the tenth slot but refuses an eleventh", async () => {
    tx.campaignRun.findFirst.mockResolvedValue({ status: "QUEUED", executionSlotClaimedAt: null });
    tx.campaignRun.count.mockResolvedValueOnce(9);
    tx.campaignRun.update.mockResolvedValue({ id: "run-10" });

    await expect(
      claimSequenceExecutionSlot(tx as never, { userId: "user-1", runId: "run-10" })
    ).resolves.toMatchObject({ acquired: true, activeCount: 10 });

    tx.campaignRun.count.mockResolvedValueOnce(10);
    await expect(
      claimSequenceExecutionSlot(tx as never, { userId: "user-1", runId: "run-11" })
    ).resolves.toMatchObject({ acquired: false, activeCount: 10 });
  });

  it("counts only queued/running runs with a durable claim", () => {
    expect(isSequenceConsumingExecutionSlot({ status: "RUNNING", executionSlotClaimedAt: new Date() })).toBe(true);
    expect(isSequenceConsumingExecutionSlot({ status: "QUEUED", executionSlotClaimedAt: new Date() })).toBe(true);
    expect(isSequenceConsumingExecutionSlot({ status: "QUEUED", executionSlotClaimedAt: null })).toBe(false);
    expect(isSequenceConsumingExecutionSlot({ status: "WAITING_FOR_SLOT", executionSlotClaimedAt: null })).toBe(false);
    expect(isSequenceConsumingExecutionSlot({ status: "PAUSED", executionSlotClaimedAt: new Date() })).toBe(false);
    expect(isSequenceConsumingExecutionSlot({ status: "COMPLETED", executionSlotClaimedAt: new Date() })).toBe(false);
  });

  it("promotes FIFO and fills only available capacity", async () => {
    tx.campaignRun.count.mockResolvedValue(9);
    tx.campaignRun.findMany.mockResolvedValue([
      {
        id: "oldest",
        campaignId: "campaign-oldest",
        campaign: {
          status: "WAITING_FOR_SLOT",
          userId: "user-1",
          import: { status: "PROCESSED" },
          senderProfile: { oauthRefreshToken: "token" }
        }
      },
      {
        id: "newer",
        campaignId: "campaign-newer",
        campaign: {
          status: "WAITING_FOR_SLOT",
          userId: "user-1",
          import: { status: "PROCESSED" },
          senderProfile: { oauthRefreshToken: "token" }
        }
      }
    ]);
    tx.campaignRun.update.mockResolvedValue({});
    tx.campaign.update.mockResolvedValue({});

    await expect(promoteWaitingSequencesForUser("user-1")).resolves.toEqual({
      promotedRunIds: ["oldest"]
    });
    expect(tx.campaignRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ waitingForSlotAt: "asc" }, { id: "asc" }] })
    );
    expect(tx.campaignRun.update).toHaveBeenCalledTimes(1);
  });
});
