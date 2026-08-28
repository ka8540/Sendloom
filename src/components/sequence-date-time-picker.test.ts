import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  clampTimeField,
  compareCalendarDates,
  composeLocalDateTimeValue,
  formatSequenceDateTime,
  getCalendarGrid,
  getZonedDateTimeParts,
  isFutureLocalDateTimeValue,
  parseLocalDateTimeValue,
  toTwelveHourTime,
  toTwentyFourHour
} from "@/components/sequence-date-time-picker-utils";

const PICKER = readFileSync("src/components/sequence-date-time-picker.tsx", "utf8");
const PICKER_CSS = readFileSync("src/components/sequence-date-time-picker.module.css", "utf8");

describe("SequenceDateTimePicker calendar helpers", () => {
  it("derives the visible month from runtime timezone data", () => {
    const phoenix = getZonedDateTimeParts(new Date("2026-09-01T05:30:00.000Z"), "America/Phoenix");
    const newYork = getZonedDateTimeParts(new Date("2026-09-01T05:30:00.000Z"), "America/New_York");

    expect(phoenix).toMatchObject({ year: 2026, month: 8, day: 31, hour: 22, minute: 30 });
    expect(newYork).toMatchObject({ year: 2026, month: 9, day: 1, hour: 1, minute: 30 });
    expect(PICKER).toContain("const initialDate = parsedValue ?? today");
    expect(PICKER).toContain("getZonedDateTimeParts(new Date(), timeZone)");
  });

  it("calculates weekday offsets, month lengths, and leap-year February", () => {
    const february2028 = getCalendarGrid(2028, 2);
    const renderedDays = february2028.filter((day): day is number => day !== null);

    expect(february2028.slice(0, 2)).toEqual([null, null]);
    expect(renderedDays).toHaveLength(29);
    expect(renderedDays.at(-1)).toBe(29);
    expect(getCalendarGrid(2026, 8).filter(Boolean)).toHaveLength(31);
  });

  it("orders calendar dates so past days can be disabled", () => {
    const today = { year: 2026, month: 8, day: 27 };

    expect(compareCalendarDates({ year: 2026, month: 8, day: 26 }, today)).toBeLessThan(0);
    expect(compareCalendarDates(today, today)).toBe(0);
    expect(compareCalendarDates({ year: 2026, month: 9, day: 1 }, today)).toBeGreaterThan(0);
    expect(PICKER).toContain("disabled={disabled}");
    expect(PICKER).toContain("minDate && minDate > now ? minDate : now");
  });

  it("preserves the local datetime contract", () => {
    const value = composeLocalDateTimeValue({ year: 2026, month: 8, day: 28, hour: 9, minute: 30 });

    expect(value).toBe("2026-08-28T09:30");
    expect(parseLocalDateTimeValue(value)).toEqual({ year: 2026, month: 8, day: 28, hour: 9, minute: 30 });
    expect(parseLocalDateTimeValue("2026-02-30T09:30")).toBeNull();
    expect(parseLocalDateTimeValue("2026-08-28T25:00")).toBeNull();
    expect(formatSequenceDateTime(value)).toBe("Aug 28, 2026 · 9:30 AM");
  });
});

describe("SequenceDateTimePicker time conversion", () => {
  it("converts AM, PM, noon, and midnight correctly", () => {
    expect(toTwentyFourHour(9, "AM")).toBe(9);
    expect(toTwentyFourHour(9, "PM")).toBe(21);
    expect(toTwentyFourHour(12, "AM")).toBe(0);
    expect(toTwentyFourHour(12, "PM")).toBe(12);
    expect(toTwelveHourTime(0, 0)).toEqual({ hour: 12, minute: 0, period: "AM" });
    expect(toTwelveHourTime(12, 0)).toEqual({ hour: 12, minute: 0, period: "PM" });
  });

  it("rejects impossible hours and clamps invalid typed values on blur", () => {
    expect(toTwentyFourHour(0, "AM")).toBeNull();
    expect(toTwentyFourHour(13, "PM")).toBeNull();
    expect(clampTimeField("99", 1, 12, 9)).toBe(12);
    expect(clampTimeField("99", 0, 59, 0)).toBe(59);
    expect(clampTimeField("", 1, 12, 9)).toBe(9);
    expect(clampTimeField("NaN", 0, 59, 0)).toBe(0);
  });

  it("validates the same wall-clock fields in the selected timezone without mutating them", () => {
    const value = "2026-08-28T09:30";
    const now = new Date("2026-08-28T14:00:00.000Z");

    expect(isFutureLocalDateTimeValue(value, "America/Phoenix", now)).toBe(true);
    expect(isFutureLocalDateTimeValue(value, "America/New_York", now)).toBe(false);
    expect(value).toBe("2026-08-28T09:30");
  });
});

describe("SequenceDateTimePicker interaction and styling contract", () => {
  it("supports the requested popover open and close behavior", () => {
    expect(PICKER).toContain("aria-expanded={open}");
    expect(PICKER).toContain('role="dialog"');
    expect(PICKER).toContain('document.addEventListener("pointerdown", handlePointerDown)');
    expect(PICKER).toContain('event.key === "Escape"');
    expect(PICKER).toContain("triggerRef.current?.focus()");
    expect(PICKER).toContain("onClick={closePopover}");
  });

  it("keeps the compact popover away from viewport edges", () => {
    expect(PICKER).toContain('data-placement={placement}');
    expect(PICKER).toContain("availableBelow < dialogHeight");
    expect(PICKER).toContain("availableAbove > availableBelow");
    expect(PICKER).toContain('"--popover-max-height"');
    expect(PICKER).toContain('window.addEventListener("resize", updatePlacement)');
    expect(PICKER).toContain('window.addEventListener("scroll", updatePlacement, true)');
    expect(PICKER_CSS).toContain('width: min(19.75rem, calc(100vw - 2rem));');
    expect(PICKER_CSS).toContain('.popover[data-placement="above"]');
    expect(PICKER_CSS).toContain('bottom: calc(100% + 0.65rem);');
    expect(PICKER_CSS).toContain('max-height: min(calc(100dvh - 2rem), var(--popover-max-height, 100dvh));');
  });

  it("exposes accessible calendar, time, and selection controls", () => {
    for (const text of [
      'aria-label="Previous month"',
      'aria-label="Next month"',
      'aria-label="Calendar month"',
      'aria-label="Calendar year"',
      'aria-label="Hour"',
      'aria-label="Minute"',
      'aria-label="AM or PM"',
      "aria-selected={selected}",
      "aria-pressed={period === option}"
    ]) {
      expect(PICKER).toContain(text);
    }
    expect(PICKER).toContain("disabled={disabled}");
    expect(PICKER).toContain('aria-current={isToday ? "date" : undefined}');
  });

  it("uses Sendloom tokens, responsive sizing, and no reference-component side effects", () => {
    expect(PICKER_CSS).toContain("background: var(--accent);");
    expect(PICKER_CSS).toContain("color: var(--accent-contrast);");
    expect(PICKER_CSS).toContain("width: min(19.75rem, calc(100vw - 2rem));");
    expect(PICKER_CSS).toContain("grid-template-columns: repeat(7, minmax(0, 1fr));");
    expect(PICKER_CSS).toContain("@media (max-width: 420px)");
    expect(PICKER_CSS).toContain("@media (prefers-reduced-motion: reduce)");

    for (const forbidden of ["#FF3B30", "2022", "09:41", "document.documentElement", "classList.add", "classList.remove"]) {
      expect(PICKER).not.toContain(forbidden);
      expect(PICKER_CSS).not.toContain(forbidden);
    }
  });
});
