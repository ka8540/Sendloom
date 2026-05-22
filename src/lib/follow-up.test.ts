import { describe, expect, it } from "vitest";

import { isFollowUpSendMode, toReplySubject, validateFollowUpConfig } from "@/lib/follow-up";

describe("validateFollowUpConfig", () => {
  const now = new Date("2026-05-22T12:00:00.000Z");
  const future = new Date("2026-05-23T12:00:00.000Z").toISOString();
  const past = new Date("2026-05-21T12:00:00.000Z").toISOString();

  it("passes when follow-up is disabled regardless of other fields", () => {
    expect(validateFollowUpConfig({ enabled: false }, now)).toEqual({ ok: true });
  });

  it("requires a template when enabled", () => {
    const result = validateFollowUpConfig(
      { enabled: true, templateId: null, sendMode: "new_email", scheduledAt: future },
      now
    );
    expect(result.ok).toBe(false);
  });

  it("requires a valid send mode when enabled", () => {
    const result = validateFollowUpConfig(
      { enabled: true, templateId: "tpl_1", sendMode: "carrier-pigeon", scheduledAt: future },
      now
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a follow-up scheduled in the past", () => {
    const result = validateFollowUpConfig(
      { enabled: true, templateId: "tpl_1", sendMode: "same_thread", scheduledAt: past },
      now
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a fully valid future follow-up", () => {
    expect(
      validateFollowUpConfig(
        { enabled: true, templateId: "tpl_1", sendMode: "same_thread", scheduledAt: future },
        now
      )
    ).toEqual({ ok: true });
  });
});

describe("isFollowUpSendMode", () => {
  it("accepts the two supported modes", () => {
    expect(isFollowUpSendMode("same_thread")).toBe(true);
    expect(isFollowUpSendMode("new_email")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isFollowUpSendMode("reply")).toBe(false);
    expect(isFollowUpSendMode(null)).toBe(false);
    expect(isFollowUpSendMode(undefined)).toBe(false);
  });
});

describe("toReplySubject", () => {
  it("adds a Re: prefix", () => {
    expect(toReplySubject("Quick question")).toBe("Re: Quick question");
  });

  it("does not stack Re: prefixes", () => {
    expect(toReplySubject("Re: Re: Hello")).toBe("Re: Hello");
    expect(toReplySubject("RE: Hello")).toBe("Re: Hello");
  });
});
