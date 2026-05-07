"use client";

import { Loader2, PencilLine, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { useErrorToast, useErrorToastEffect } from "@/components/error-toast-provider";
import { convertScheduledLocalInputToUtc, fallbackTimeZones } from "@/lib/schedule";
import type { ScheduleRule } from "@/lib/types";
import styles from "./campaign-schedule-editor.module.css";

type ScheduleConfig =
  | {
      type: "immediate";
    }
  | {
      type: "once";
      scheduledFor?: string;
      timeZone?: string;
    }
  | {
      type: "recurring";
      frequency?: "daily" | "weekly";
      time?: string;
      dayOfWeek?: number;
      daysOfWeek?: number[];
      timeZone?: string;
    };

type ScheduleDraft = {
  daysOfWeek: string[];
  frequency: "" | "daily" | "weekly";
  scheduledFor: string;
  time: string;
  timeZone: string;
  type: "immediate" | "once" | "recurring";
};

const timeZoneLabels = new Map<string, string>([
  ["America/New_York", "Eastern Time (America/New_York)"],
  ["America/Chicago", "Central Time (America/Chicago)"],
  ["America/Denver", "Mountain Time (America/Denver)"],
  ["America/Los_Angeles", "Pacific Time (America/Los_Angeles)"],
  ["America/Phoenix", "Arizona Time (America/Phoenix)"],
  ["America/Toronto", "Toronto (America/Toronto)"],
  ["America/Vancouver", "Vancouver (America/Vancouver)"],
  ["Europe/London", "London (Europe/London)"],
  ["Europe/Berlin", "Berlin (Europe/Berlin)"],
  ["Europe/Paris", "Paris (Europe/Paris)"],
  ["Asia/Dubai", "Dubai (Asia/Dubai)"],
  ["Asia/Kolkata", "India (Asia/Kolkata)"],
  ["Asia/Singapore", "Singapore (Asia/Singapore)"],
  ["Asia/Tokyo", "Tokyo (Asia/Tokyo)"],
  ["Australia/Sydney", "Sydney (Australia/Sydney)"],
  ["Pacific/Auckland", "Auckland (Pacific/Auckland)"]
]);

const weekdayOptions = [
  { label: "Sun", value: "0" },
  { label: "Mon", value: "1" },
  { label: "Tue", value: "2" },
  { label: "Wed", value: "3" },
  { label: "Thu", value: "4" },
  { label: "Fri", value: "5" },
  { label: "Sat", value: "6" }
] as const;

function getDraftWeekdays(scheduleConfig: Extract<ScheduleConfig, { type: "recurring" }>) {
  const days = scheduleConfig.daysOfWeek?.length ? scheduleConfig.daysOfWeek : [scheduleConfig.dayOfWeek ?? 1];
  return Array.from(new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)))
    .sort((left, right) => left - right)
    .map(String);
}

function formatDateTimeLocal(value: string | undefined, timeZone: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function createDraft(scheduleConfig: ScheduleConfig, browserTimeZone: string): ScheduleDraft {
  if (scheduleConfig.type === "once") {
    const timeZone = scheduleConfig.timeZone ?? browserTimeZone;

    return {
      daysOfWeek: ["1"],
      frequency: "",
      scheduledFor: formatDateTimeLocal(scheduleConfig.scheduledFor, timeZone),
      time: "",
      timeZone,
      type: "once"
    };
  }

  if (scheduleConfig.type === "recurring") {
    return {
      daysOfWeek: getDraftWeekdays(scheduleConfig),
      frequency: scheduleConfig.frequency ?? "",
      scheduledFor: "",
      time: scheduleConfig.time ?? "",
      timeZone: scheduleConfig.timeZone ?? browserTimeZone,
      type: "recurring"
    };
  }

  return {
    daysOfWeek: ["1"],
    frequency: "",
    scheduledFor: "",
    time: "",
    timeZone: browserTimeZone,
    type: "immediate"
  };
}

function buildScheduleRule(draft: ScheduleDraft): ScheduleRule {
  if (draft.type === "immediate") {
    return { type: "immediate" };
  }

  if (draft.type === "once") {
    if (!draft.scheduledFor) {
      throw new Error("Choose a future date and time.");
    }

    const scheduledFor = convertScheduledLocalInputToUtc(draft.scheduledFor, draft.timeZone);
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date()) {
      throw new Error("Choose a future date and time in the selected timezone.");
    }

    return {
      type: "once",
      scheduledFor: scheduledFor.toISOString(),
      timeZone: draft.timeZone
    };
  }

  if (!draft.frequency) {
    throw new Error("Choose how often this sequence should repeat.");
  }

  if (!/^\d{2}:\d{2}$/.test(draft.time)) {
    throw new Error("Choose a valid recurring send time.");
  }

  if (draft.frequency === "weekly" && draft.daysOfWeek.length === 0) {
    throw new Error("Select at least one day.");
  }

  return {
    type: "recurring",
    frequency: draft.frequency,
    time: draft.time,
    timeZone: draft.timeZone,
    ...(draft.frequency === "weekly" ? { daysOfWeek: draft.daysOfWeek.map(Number) } : {})
  };
}

export function CampaignScheduleEditor(props: {
  campaignId: string;
  canEdit: boolean;
  className?: string;
  disabledMessage: string;
  initialSchedule: ScheduleConfig;
}) {
  const router = useRouter();
  const browserTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York", []);
  const timeZoneOptions = useMemo(
    () =>
      Array.from(new Set([browserTimeZone, ...fallbackTimeZones])).map((timeZone) => ({
        value: timeZone,
        label: timeZoneLabels.get(timeZone) ?? timeZone
      })),
    [browserTimeZone]
  );
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft>(() => createDraft(props.initialSchedule, browserTimeZone));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showError } = useErrorToast();
  useErrorToastEffect(error, "Schedule update failed");

  useEffect(() => {
    setDraft(createDraft(props.initialSchedule, browserTimeZone));
    setError(null);
    setPending(false);
    setIsOpen(false);
  }, [browserTimeZone, props.initialSchedule]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, pending]);

  function openEditor() {
    if (!props.canEdit) {
      showError(props.disabledMessage, { title: "Schedule update unavailable" });
      return;
    }

    setDraft(createDraft(props.initialSchedule, browserTimeZone));
    setError(null);
    setIsOpen(true);
  }

  function closeEditor() {
    if (!pending) {
      setIsOpen(false);
      setError(null);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }

    let scheduleRule: ScheduleRule;
    try {
      scheduleRule = buildScheduleRule(draft);
    } catch (scheduleError) {
      setError(scheduleError instanceof Error ? scheduleError.message : "Choose a valid send schedule.");
      return;
    }

    setPending(true);
    setError(null);

    const formData = new FormData();
    formData.set("scheduleRule", JSON.stringify(scheduleRule));

    try {
      const response = await fetch(`/api/campaigns/${props.campaignId}`, {
        method: "PATCH",
        body: formData
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(payload.error ?? "Could not save the sequence schedule.");
        setPending(false);
        return;
      }

      setIsOpen(false);
      setPending(false);
      router.refresh();
    } catch {
      setError("Could not save the sequence schedule.");
      setPending(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={props.className}>
        <button
          aria-disabled={!props.canEdit}
          className={`button secondary ${styles.scheduleButton}${!props.canEdit ? ` ${styles.blockedButton}` : ""}`}
          type="button"
          onClick={openEditor}
          title={props.canEdit ? "Edit sequence timing" : props.disabledMessage}
        >
          <PencilLine aria-hidden="true" />
          <span>Edit sequence</span>
        </button>
      </div>

      {isOpen ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={closeEditor}>
          <div
            aria-labelledby="edit-sequence-title"
            aria-modal="true"
            className={styles.modalCard}
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <h2 id="edit-sequence-title">Edit sequence</h2>
                <p>Update when this sequence should send.</p>
              </div>
              <button
                aria-label="Close edit sequence dialog"
                className={styles.modalClose}
                disabled={pending}
                onClick={closeEditor}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>

            <form className={styles.modalForm} onSubmit={onSubmit}>
              <div className={styles.modalBody}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="edit-sequence-schedule-type">
                    Send timing
                  </label>
                  <select
                    className={styles.control}
                    id="edit-sequence-schedule-type"
                    value={draft.type}
                    onChange={(event) => {
                      const nextType = event.target.value as ScheduleDraft["type"];
                      setDraft((current) => ({
                        ...current,
                        type: nextType,
                        frequency: nextType === "recurring" && !current.frequency ? "weekly" : current.frequency,
                        daysOfWeek: nextType === "recurring" && !current.daysOfWeek.length ? ["1"] : current.daysOfWeek,
                        time: nextType === "recurring" && !current.time ? "09:00" : current.time
                      }));
                      setError(null);
                    }}
                  >
                    <option value="immediate">Right away</option>
                    <option value="once">Schedule once</option>
                    <option value="recurring">Repeat on a schedule</option>
                  </select>
                </div>

                {draft.type === "once" ? (
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="edit-sequence-scheduled-for">
                      Send on
                    </label>
                    <input
                      className={styles.control}
                      id="edit-sequence-scheduled-for"
                      type="datetime-local"
                      value={draft.scheduledFor}
                      onChange={(event) => {
                        setDraft((current) => ({ ...current, scheduledFor: event.target.value }));
                        setError(null);
                      }}
                      required
                    />
                  </div>
                ) : null}

                {draft.type !== "immediate" ? (
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="edit-sequence-time-zone">
                      Send in timezone
                    </label>
                    <select
                      className={styles.control}
                      id="edit-sequence-time-zone"
                      value={draft.timeZone}
                      onChange={(event) => {
                        setDraft((current) => ({ ...current, timeZone: event.target.value }));
                        setError(null);
                      }}
                    >
                      {timeZoneOptions.map((timeZone) => (
                        <option key={timeZone.value} value={timeZone.value}>
                          {timeZone.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {draft.type === "recurring" ? (
                  <div className={styles.recurringGrid}>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor="edit-sequence-frequency">
                        Repeat
                      </label>
                      <select
                        className={styles.control}
                        id="edit-sequence-frequency"
                        value={draft.frequency}
                        onChange={(event) => {
                          setDraft((current) => ({
                            ...current,
                            frequency: event.target.value as ScheduleDraft["frequency"]
                          }));
                          setError(null);
                        }}
                        required
                      >
                        <option value="" disabled>
                          Choose repeat
                        </option>
                        <option value="daily">Every day</option>
                        <option value="weekly">Every week</option>
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor="edit-sequence-time">
                        Send at
                      </label>
                      <input
                        className={styles.control}
                        id="edit-sequence-time"
                        type="time"
                        value={draft.time}
                        onChange={(event) => {
                          setDraft((current) => ({ ...current, time: event.target.value }));
                          setError(null);
                        }}
                        required
                      />
                    </div>
                    {draft.frequency === "weekly" ? (
                      <div className={`${styles.field} ${styles.weekdayField}`}>
                        <span className={styles.fieldLabel}>Days</span>
                        <div className={styles.weekdayGroup} aria-label="Recurring weekdays">
                          {weekdayOptions.map((day) => {
                            const selected = draft.daysOfWeek.includes(day.value);
                            return (
                              <button
                                key={day.value}
                                type="button"
                                className={`${styles.weekdayChip}${selected ? ` ${styles.weekdayChipSelected}` : ""}`}
                                aria-pressed={selected}
                                onClick={() => {
                                  setDraft((current) => {
                                    const isSelected = current.daysOfWeek.includes(day.value);
                                    const nextDays = isSelected
                                      ? current.daysOfWeek.filter((value) => value !== day.value)
                                      : [...current.daysOfWeek, day.value].sort((left, right) => Number(left) - Number(right));

                                    return {
                                      ...current,
                                      daysOfWeek: nextDays
                                    };
                                  });
                                  setError(null);
                                }}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {draft.type !== "immediate" ? (
                  <p className={styles.timeZoneHint}>This schedule will run in {draft.timeZone}.</p>
                ) : null}

                {error ? <div className={styles.modalError}>{error}</div> : null}
              </div>

              <div className={styles.modalActions}>
                <button
                  className={`button secondary ${styles.modalButton}`}
                  type="button"
                  onClick={closeEditor}
                  disabled={pending}
                >
                  Cancel
                </button>
                <button className={`button ${styles.modalButton}`} type="submit" disabled={pending}>
                  {pending ? (
                    <>
                      <Loader2 aria-hidden="true" className={styles.spin} />
                      Saving...
                    </>
                  ) : (
                    "Save changes"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
