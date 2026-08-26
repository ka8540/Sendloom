import { SystemNoticeType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  ensureFutureScheduledInstant,
  normalizeIanaTimeZone,
  systemNoticeInputSchema
} from "@/lib/system-notices";

const valid = {
  type: SystemNoticeType.GENERAL,
  subject: "Sendloom service notice",
  title: "Service update",
  message: "We are sharing an operational update.",
  affectedArea: null,
  scheduledSendAt: "2026-09-02T20:00:00.000Z",
  impactStartsAt: "2026-09-02T21:00:00.000Z",
  impactEndsAt: "2026-09-02T22:00:00.000Z",
  timeZone: "America/Phoenix"
};

describe("system notice validation", () => {
  it("requires bounded plain text fields", () => {
    expect(() => systemNoticeInputSchema.parse({ ...valid, subject: "" })).toThrow(/Subject is required/);
    expect(() => systemNoticeInputSchema.parse({ ...valid, message: "   " })).toThrow(/Message is required/);
    expect(() => systemNoticeInputSchema.parse({ ...valid, subject: "x".repeat(161) })).toThrow();
    expect(() => systemNoticeInputSchema.parse({ ...valid, rawHtml: "<b>not allowed</b>" })).toThrow();
  });

  it("rejects invalid IANA zones and preserves a canonical valid zone", () => {
    expect(normalizeIanaTimeZone("Not/A_Real_Zone")).toBeNull();
    expect(normalizeIanaTimeZone("+07:00")).toBeNull();
    expect(systemNoticeInputSchema.parse(valid).timeZone).toBe("America/Phoenix");
    expect(() => systemNoticeInputSchema.parse({ ...valid, timeZone: "Mars/Olympus" })).toThrow(/valid IANA timezone/);
  });

  it("requires an impact end after the impact start", () => {
    expect(() =>
      systemNoticeInputSchema.parse({
        ...valid,
        impactStartsAt: "2026-09-02T22:00:00.000Z",
        impactEndsAt: "2026-09-02T21:00:00.000Z"
      })
    ).toThrow(/Impact end must be after impact start/);
  });

  it("rejects past scheduled instants on the server", () => {
    expect(() =>
      ensureFutureScheduledInstant(new Date("2026-08-24T11:59:59Z"), new Date("2026-08-24T12:00:00Z"))
    ).toThrow(/future/);
    expect(
      ensureFutureScheduledInstant(new Date("2026-08-24T12:00:01Z"), new Date("2026-08-24T12:00:00Z"))
    ).toEqual(new Date("2026-08-24T12:00:01Z"));
  });
});
