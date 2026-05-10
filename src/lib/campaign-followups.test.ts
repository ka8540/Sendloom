import { describe, expect, it } from "vitest";

import {
  addFollowUpDelay,
  canProcessFollowUpsForRunStatus,
  getFollowUpSendSubject,
  mergeReferencesHeader,
  validateFollowUpConfig
} from "@/lib/campaign-followups";

describe("campaign follow-up validation", () => {
  it("accepts disabled follow-ups without requiring fields", () => {
    const result = validateFollowUpConfig({ enabled: false });

    expect(result).toEqual({
      ok: true,
      config: {
        enabled: false,
        templateId: null,
        delayDays: null,
        sendMode: null
      }
    });
  });

  it("rejects enabled follow-ups without a template", () => {
    const result = validateFollowUpConfig({
      enabled: true,
      delayDays: 3,
      sendMode: "SAME_THREAD"
    });

    expect(result).toEqual({
      ok: false,
      error: "Select a follow-up template."
    });
  });

  it("rejects delays shorter than one day", () => {
    const result = validateFollowUpConfig({
      enabled: true,
      templateId: "template-id",
      delayDays: 0,
      sendMode: "SAME_THREAD"
    });

    expect(result).toEqual({
      ok: false,
      error: "Enter a delay of at least 1 day."
    });
  });

  it("rejects missing send mode", () => {
    const result = validateFollowUpConfig({
      enabled: true,
      templateId: "template-id",
      delayDays: 3
    });

    expect(result).toEqual({
      ok: false,
      error: "Choose how the follow-up should be sent."
    });
  });

  it("requires a subject for new-email follow-ups", () => {
    const result = validateFollowUpConfig(
      {
        enabled: true,
        templateId: "template-id",
        delayDays: 3,
        sendMode: "NEW_EMAIL"
      },
      {
        followUpTemplateSubject: " ",
        validateTemplateSubject: true
      }
    );

    expect(result).toEqual({
      ok: false,
      error: "New email follow-ups require a subject."
    });
  });

  it("computes due time from first email success", () => {
    const sentAt = new Date("2026-05-06T12:00:00.000Z");

    expect(addFollowUpDelay(sentAt, 3).toISOString()).toBe("2026-05-09T12:00:00.000Z");
  });

  it("allows completed runs to process due follow-ups", () => {
    expect(canProcessFollowUpsForRunStatus("COMPLETED")).toBe(true);
    expect(canProcessFollowUpsForRunStatus("RUNNING")).toBe(true);
    expect(canProcessFollowUpsForRunStatus("CANCELLED")).toBe(false);
  });

  it("keeps same-thread follow-ups on the original subject", () => {
    expect(
      getFollowUpSendSubject({
        sendMode: "SAME_THREAD",
        originalSubject: "Original outreach",
        renderedFollowUpSubject: "Different follow-up subject"
      })
    ).toBe("Re: Original outreach");
    expect(
      getFollowUpSendSubject({
        sendMode: "SAME_THREAD",
        originalSubject: " ",
        renderedFollowUpSubject: "Different follow-up subject"
      })
    ).toBe("");
  });

  it("uses the follow-up template subject for new-email follow-ups", () => {
    expect(
      getFollowUpSendSubject({
        sendMode: "NEW_EMAIL",
        originalSubject: "Original outreach",
        renderedFollowUpSubject: "Different follow-up subject"
      })
    ).toBe("Different follow-up subject");
  });

  it("reuses original message metadata for same-thread references", () => {
    expect(mergeReferencesHeader("<first@example.com>", "<second@example.com>")).toBe(
      "<first@example.com> <second@example.com>"
    );
    expect(mergeReferencesHeader("<first@example.com>", "<first@example.com>")).toBe("<first@example.com>");
  });
});
