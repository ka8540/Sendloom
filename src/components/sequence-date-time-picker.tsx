"use client";

import { CalendarClock, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

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
  toTwentyFourHour,
  type CalendarDateParts
} from "@/components/sequence-date-time-picker-utils";
import styles from "./sequence-date-time-picker.module.css";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const POPOVER_VIEWPORT_MARGIN = 16;
const POPOVER_TRIGGER_GAP = 11;

type SequenceDateTimePickerProps = {
  id?: string;
  value: string;
  timeZone: string;
  onChange(value: string): void;
  minDate?: Date;
};

function formatDateLabel(date: CalendarDateParts) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}

function sameCalendarDate(left: CalendarDateParts | null, right: CalendarDateParts) {
  return Boolean(
    left && left.year === right.year && left.month === right.month && left.day === right.day
  );
}

export function SequenceDateTimePicker({
  id = "scheduledFor-control",
  value,
  timeZone,
  onChange,
  minDate
}: SequenceDateTimePickerProps) {
  const parsedValue = parseLocalDateTimeValue(value);
  const now = new Date();
  const today = getZonedDateTimeParts(now, timeZone);
  const minimumDate = getZonedDateTimeParts(minDate && minDate > now ? minDate : now, timeZone);
  const initialDate = parsedValue ?? today;
  const initialTime = toTwelveHourTime(parsedValue?.hour ?? 9, parsedValue?.minute ?? 0);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"above" | "below">("below");
  const [popoverMaxHeight, setPopoverMaxHeight] = useState<number | null>(null);
  const [displayMonth, setDisplayMonth] = useState({ year: initialDate.year, month: initialDate.month });
  const [selectedDate, setSelectedDate] = useState<CalendarDateParts | null>(
    parsedValue
      ? { year: parsedValue.year, month: parsedValue.month, day: parsedValue.day }
      : null
  );
  const [hourInput, setHourInput] = useState(String(initialTime.hour).padStart(2, "0"));
  const [minuteInput, setMinuteInput] = useState(String(initialTime.minute).padStart(2, "0"));
  const [period, setPeriod] = useState<"AM" | "PM">(initialTime.period);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const generatedId = useId();
  const dialogId = `${generatedId}-dialog`;
  const headingId = `${generatedId}-heading`;
  const calendarDays = useMemo(
    () => getCalendarGrid(displayMonth.year, displayMonth.month),
    [displayMonth.month, displayMonth.year]
  );
  const firstYear = minimumDate.year;
  const lastYear = firstYear + 5;
  const yearOptions = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);
  const previousMonthDisabled =
    displayMonth.year < firstYear ||
    (displayMonth.year === firstYear && displayMonth.month === 1);
  const nextMonthDisabled = displayMonth.year === lastYear && displayMonth.month === 12;
  const hasValidSelection = isFutureLocalDateTimeValue(value, timeZone, now);

  useEffect(() => {
    const nextValue = parseLocalDateTimeValue(value);
    if (!nextValue) return;

    const nextTime = toTwelveHourTime(nextValue.hour, nextValue.minute);
    setSelectedDate({ year: nextValue.year, month: nextValue.month, day: nextValue.day });
    setHourInput(String(nextTime.hour).padStart(2, "0"));
    setMinuteInput(String(nextTime.minute).padStart(2, "0"));
    setPeriod(nextTime.period);
  }, [value]);

  useEffect(() => {
    if (!open) return;

    function closeAndRestoreFocus() {
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        closeAndRestoreFocus();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    function updatePlacement() {
      const trigger = triggerRef.current;
      const dialog = dialogRef.current;
      if (!trigger || !dialog) return;

      const triggerRect = trigger.getBoundingClientRect();
      const dialogHeight = dialog.getBoundingClientRect().height;
      const availableBelow =
        window.innerHeight - triggerRect.bottom - POPOVER_VIEWPORT_MARGIN - POPOVER_TRIGGER_GAP;
      const availableAbove =
        triggerRect.top - POPOVER_VIEWPORT_MARGIN - POPOVER_TRIGGER_GAP;
      const shouldOpenAbove =
        availableBelow < dialogHeight && availableAbove > availableBelow;
      const nextPlacement = shouldOpenAbove ? "above" : "below";
      const availableHeight = nextPlacement === "above" ? availableAbove : availableBelow;

      setPlacement(nextPlacement);
      setPopoverMaxHeight(Math.max(0, Math.floor(availableHeight)));
    }

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);

    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [calendarDays.length, open]);

  function closePopover() {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function openPopover() {
    const currentValue = parseLocalDateTimeValue(value);
    const focusDate = currentValue ?? getZonedDateTimeParts(new Date(), timeZone);
    setDisplayMonth({ year: focusDate.year, month: focusDate.month });
    setPlacement("below");
    setPopoverMaxHeight(null);
    setOpen(true);
  }

  function setMonthOffset(offset: number) {
    setDisplayMonth((current) => {
      const nextDate = new Date(Date.UTC(current.year, current.month - 1 + offset, 1));
      return { year: nextDate.getUTCFullYear(), month: nextDate.getUTCMonth() + 1 };
    });
  }

  function commitTime(
    nextHour: string,
    nextMinute: string,
    nextPeriod: "AM" | "PM",
    date = selectedDate
  ) {
    const hour = Number(nextHour);
    const minute = Number(nextMinute);
    const hour24 = toTwentyFourHour(hour, nextPeriod);

    if (!date || hour24 === null || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      if (date) onChange("");
      return;
    }

    const nextValue = composeLocalDateTimeValue({ ...date, hour: hour24, minute });
    onChange(isFutureLocalDateTimeValue(nextValue, timeZone) ? nextValue : "");
  }

  function chooseDate(day: number) {
    const nextDate = { year: displayMonth.year, month: displayMonth.month, day };
    let nextHour = Number(hourInput);
    let nextMinute = Number(minuteInput);
    let nextPeriod = period;
    const hour24 = toTwentyFourHour(nextHour, nextPeriod);
    const currentCandidate =
      hour24 === null || !Number.isInteger(nextMinute) || nextMinute < 0 || nextMinute > 59
        ? ""
        : composeLocalDateTimeValue({ ...nextDate, hour: hour24, minute: nextMinute });

    if (!currentCandidate || !isFutureLocalDateTimeValue(currentCandidate, timeZone)) {
      const zonedNow = getZonedDateTimeParts(new Date(), timeZone);
      const isToday = sameCalendarDate(zonedNow, nextDate);
      const nextSlot = Math.ceil((zonedNow.hour * 60 + zonedNow.minute + 1) / 15) * 15;

      if (isToday && nextSlot < 24 * 60) {
        const futureTime = toTwelveHourTime(Math.floor(nextSlot / 60), nextSlot % 60);
        nextHour = futureTime.hour;
        nextMinute = futureTime.minute;
        nextPeriod = futureTime.period;
      } else {
        nextHour = 9;
        nextMinute = 0;
        nextPeriod = "AM";
      }
    }

    setSelectedDate(nextDate);
    setHourInput(String(nextHour).padStart(2, "0"));
    setMinuteInput(String(nextMinute).padStart(2, "0"));
    setPeriod(nextPeriod);
    commitTime(String(nextHour), String(nextMinute), nextPeriod, nextDate);
  }

  function handleHourBlur() {
    const normalizedHour = clampTimeField(hourInput, 1, 12, 9);
    const nextHour = String(normalizedHour).padStart(2, "0");
    setHourInput(nextHour);
    commitTime(nextHour, minuteInput, period);
  }

  function handleMinuteBlur() {
    const normalizedMinute = clampTimeField(minuteInput, 0, 59, 0);
    const nextMinute = String(normalizedMinute).padStart(2, "0");
    setMinuteInput(nextMinute);
    commitTime(hourInput, nextMinute, period);
  }

  return (
    <div className={styles.pickerField} ref={containerRef}>
      <label className={styles.fieldLabel} htmlFor={id}>Schedule date &amp; time</label>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        data-open={open || undefined}
        onClick={() => (open ? closePopover() : openPopover())}
      >
        <span className={styles.triggerIcon} aria-hidden="true"><CalendarClock /></span>
        <span className={styles.triggerCopy}>
          <strong>{formatSequenceDateTime(value)}</strong>
          <span title={timeZone}>Times shown in {timeZone}</span>
        </span>
        <ChevronRight className={styles.triggerChevron} aria-hidden="true" />
      </button>

      {open ? (
        <div
          ref={dialogRef}
          id={dialogId}
          className={styles.popover}
          data-placement={placement}
          style={popoverMaxHeight === null ? undefined : {
            "--popover-max-height": `${popoverMaxHeight}px`
          } as CSSProperties}
          role="dialog"
          aria-modal="false"
          aria-labelledby={headingId}
          tabIndex={-1}
        >
          <div className={styles.popoverHeading}>
            <span>
              <strong id={headingId}>Schedule date and time</strong>
              <small title={timeZone}>{timeZone}</small>
            </span>
          </div>

          <div className={styles.calendarHeader}>
            <div className={styles.monthYearSelectors}>
              <label>
                <span className={styles.visuallyHidden}>Month</span>
                <select
                  aria-label="Calendar month"
                  value={displayMonth.month}
                  onChange={(event) =>
                    setDisplayMonth((current) => ({ ...current, month: Number(event.target.value) }))
                  }
                >
                  {MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
                </select>
              </label>
              <label>
                <span className={styles.visuallyHidden}>Year</span>
                <select
                  aria-label="Calendar year"
                  value={displayMonth.year}
                  onChange={(event) =>
                    setDisplayMonth((current) => ({ ...current, year: Number(event.target.value) }))
                  }
                >
                  {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </label>
            </div>
            <div className={styles.monthNavigation}>
              <button
                type="button"
                aria-label="Previous month"
                disabled={previousMonthDisabled}
                onClick={() => setMonthOffset(-1)}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Next month"
                disabled={nextMonthDisabled}
                onClick={() => setMonthOffset(1)}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className={styles.calendar} role="grid" aria-label={`${MONTHS[displayMonth.month - 1]} ${displayMonth.year}`}>
            <div className={styles.weekdayRow} role="row">
              {WEEKDAYS.map((weekday) => <span key={weekday} role="columnheader">{weekday}</span>)}
            </div>
            <div className={styles.dayGrid} role="rowgroup">
              {calendarDays.map((day, index) => {
                if (day === null) {
                  return <span key={`empty-${index}`} className={styles.emptyDay} role="gridcell" aria-hidden="true" />;
                }

                const date = { year: displayMonth.year, month: displayMonth.month, day };
                const disabled = compareCalendarDates(date, minimumDate) < 0;
                const selected = sameCalendarDate(selectedDate, date);
                const isToday = sameCalendarDate(today, date);

                return (
                  <span key={day} className={styles.dayCell} role="gridcell" aria-selected={selected}>
                    <button
                      type="button"
                      aria-label={formatDateLabel(date)}
                      aria-current={isToday ? "date" : undefined}
                      disabled={disabled}
                      data-selected={selected || undefined}
                      data-today={isToday || undefined}
                      onClick={() => chooseDate(day)}
                    >
                      {day}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>

          <div className={styles.timeSection}>
            <div className={styles.timeHeading}><Clock3 aria-hidden="true" /><span>Time</span></div>
            <div className={styles.timeControls}>
              <label>
                <span className={styles.visuallyHidden}>Hour</span>
                <input
                  aria-label="Hour"
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  value={hourInput}
                  onChange={(event) => {
                    const nextHour = event.target.value.replace(/\D/g, "").slice(0, 2);
                    setHourInput(nextHour);
                    commitTime(nextHour, minuteInput, period);
                  }}
                  onBlur={handleHourBlur}
                />
              </label>
              <span className={styles.timeSeparator} aria-hidden="true">:</span>
              <label>
                <span className={styles.visuallyHidden}>Minute</span>
                <input
                  aria-label="Minute"
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  value={minuteInput}
                  onChange={(event) => {
                    const nextMinute = event.target.value.replace(/\D/g, "").slice(0, 2);
                    setMinuteInput(nextMinute);
                    commitTime(hourInput, nextMinute, period);
                  }}
                  onBlur={handleMinuteBlur}
                />
              </label>
              <div className={styles.periodControl} aria-label="AM or PM">
                {(["AM", "PM"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={period === option}
                    data-selected={period === option || undefined}
                    onClick={() => {
                      setPeriod(option);
                      commitTime(hourInput, minuteInput, option);
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.popoverFooter}>
            <span className={styles.selectionStatus} role="status" aria-live="polite">
              {selectedDate && !hasValidSelection ? "Choose a time later than now." : "Times use the selected timezone."}
            </span>
            <button type="button" className={styles.doneButton} disabled={!hasValidSelection} onClick={closePopover}>
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
