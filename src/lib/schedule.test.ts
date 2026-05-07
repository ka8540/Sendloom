import { describe, expect, it } from "vitest";

import { convertScheduledLocalInputToUtc, getNextRunDate, normalizeScheduleRule, normalizeWeeklyDays } from "@/lib/schedule";

describe("getNextRunDate", () => {
  it("converts a selected local datetime using the chosen timezone", () => {
    const scheduledFor = convertScheduledLocalInputToUtc("2026-03-26T08:00", "America/Los_Angeles");

    expect(scheduledFor.toISOString()).toBe("2026-03-26T15:00:00.000Z");
  });

  it("keeps one-time schedules as the browser-selected UTC instant", () => {
    const nextRun = getNextRunDate({
      type: "once",
      scheduledFor: "2026-03-26T12:00:00.000Z",
      timeZone: "America/New_York"
    });

    expect(nextRun.toISOString()).toBe("2026-03-26T12:00:00.000Z");
  });

  it("calculates daily recurring runs in the user's timezone", () => {
    const nextRun = getNextRunDate(
      {
        type: "recurring",
        frequency: "daily",
        time: "09:00",
        timeZone: "America/New_York"
      },
      new Date("2026-03-26T11:00:00.000Z")
    );

    expect(nextRun.toISOString()).toBe("2026-03-26T13:00:00.000Z");
  });

  it("rolls weekly recurring runs forward when today's slot has passed", () => {
    const nextRun = getNextRunDate(
      {
        type: "recurring",
        frequency: "weekly",
        dayOfWeek: 4,
        time: "09:00",
        timeZone: "America/New_York"
      },
      new Date("2026-03-26T15:00:00.000Z")
    );

    expect(nextRun.toISOString()).toBe("2026-04-02T13:00:00.000Z");
  });

  it("keeps single-weekday recurring schedules compatible", () => {
    const nextRun = getNextRunDate(
      {
        type: "recurring",
        frequency: "weekly",
        dayOfWeek: 1,
        time: "09:00",
        timeZone: "America/New_York"
      },
      new Date("2026-03-26T15:00:00.000Z")
    );

    expect(nextRun.toISOString()).toBe("2026-03-30T13:00:00.000Z");
  });

  it("chooses the nearest future weekday from multiple selected days", () => {
    const nextRun = getNextRunDate(
      {
        type: "recurring",
        frequency: "weekly",
        daysOfWeek: [1, 3, 5],
        time: "09:00",
        timeZone: "America/New_York"
      },
      new Date("2026-03-30T14:00:00.000Z")
    );

    expect(nextRun.toISOString()).toBe("2026-04-01T13:00:00.000Z");
  });

  it("uses today's selected weekday when the send time has not passed", () => {
    const nextRun = getNextRunDate(
      {
        type: "recurring",
        frequency: "weekly",
        daysOfWeek: [1, 3, 5],
        time: "09:00",
        timeZone: "America/New_York"
      },
      new Date("2026-03-30T12:00:00.000Z")
    );

    expect(nextRun.toISOString()).toBe("2026-03-30T13:00:00.000Z");
  });

  it("returns an invalid date when weekly recurring schedules have no valid days", () => {
    const nextRun = getNextRunDate(
      {
        type: "recurring",
        frequency: "weekly",
        daysOfWeek: [],
        time: "09:00",
        timeZone: "America/New_York"
      },
      new Date("2026-03-30T12:00:00.000Z")
    );

    expect(Number.isNaN(nextRun.getTime())).toBe(true);
  });

  it("normalizes old single-day recurring data into a weekday array", () => {
    expect(
      normalizeWeeklyDays({
        type: "recurring",
        frequency: "weekly",
        dayOfWeek: 3,
        time: "09:00"
      })
    ).toEqual([3]);
  });

  it("rejects weekly recurring schedules with no selected weekdays during normalization", () => {
    expect(() =>
      normalizeScheduleRule({
        type: "recurring",
        frequency: "weekly",
        daysOfWeek: [],
        time: "09:00"
      })
    ).toThrow("Select at least one day.");
  });
});
