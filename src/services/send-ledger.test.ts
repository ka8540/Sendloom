import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendLedgerCreateMock, releaseSendReservationMock } = vi.hoisted(() => ({
  sendLedgerCreateMock: vi.fn(),
  releaseSendReservationMock: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    sendLedger: {
      create: sendLedgerCreateMock
    }
  }
}));

vi.mock("@/lib/daily-send-limit", () => ({
  releaseSendReservation: releaseSendReservationMock
}));

import { recordSendOnLedger } from "@/services/send-ledger";

function missingSendLedgerError() {
  return new Prisma.PrismaClientKnownRequestError("The table `public.SendLedger` does not exist.", {
    code: "P2021",
    clientVersion: "test",
    meta: { table: "public.SendLedger" }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordSendOnLedger", () => {
  it("releases the active reservation and does not throw when the SendLedger table is missing", async () => {
    sendLedgerCreateMock.mockRejectedValueOnce(missingSendLedgerError());

    await expect(
      recordSendOnLedger({
        scope: { userId: "user_1", senderProfileId: "sender_1" },
        reservationId: "reservation_1",
        campaignId: "campaign_1",
        campaignRunId: "run_1",
        recipientJobId: "job_1",
        messageId: "message_1"
      })
    ).resolves.toBeUndefined();

    expect(releaseSendReservationMock).toHaveBeenCalledWith(
      { userId: "user_1", senderProfileId: "sender_1" },
      "reservation_1"
    );
  });

  it("still throws non-ledger errors", async () => {
    const error = new Error("write failed");
    sendLedgerCreateMock.mockRejectedValueOnce(error);

    await expect(
      recordSendOnLedger({
        scope: { userId: "user_1" },
        reservationId: "reservation_1"
      })
    ).rejects.toThrow(error);

    expect(releaseSendReservationMock).not.toHaveBeenCalled();
  });
});
