import { describe, expect, it } from "vitest";

import { getNextRunDate } from "@/lib/schedule";

describe("getNextRunDate", () => {
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
});
