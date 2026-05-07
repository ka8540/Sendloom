"use client";

import { FilePlus2, FileText, MailPlus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { useErrorToastEffect } from "@/components/error-toast-provider";
import { mergeAttachmentFiles } from "@/lib/campaign-attachments";
import { convertScheduledLocalInputToUtc, fallbackTimeZones } from "@/lib/schedule";
import styles from "./campaign-builder.module.css";

type Option = {
  id: string;
  label: string;
};

type TemplateOption = Option & {
  subject: string;
};

type MappingOption = Option & {
  importId: string;
};

const weekdayOptions = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 }
] as const;

export function CampaignBuilder(props: {
  imports: Option[];
  mappings: MappingOption[];
  templates: TemplateOption[];
  senders: Option[];
  disconnectedSenderCount?: number;
  reconnectHref?: string;
}) {
  const router = useRouter();
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<{ pending: boolean; error?: string }>({ pending: false });
  const [attachments, setAttachments] = useState<File[]>([]);
  const [selectedImportId, setSelectedImportId] = useState(props.imports[0]?.id ?? "");
  const [scheduleType, setScheduleType] = useState("immediate");
  const [frequency, setFrequency] = useState("weekly");
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([1]);
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpTemplateId, setFollowUpTemplateId] = useState(props.templates[0]?.id ?? "");
  const [followUpDelayDays, setFollowUpDelayDays] = useState("3");
  const [followUpSendMode, setFollowUpSendMode] = useState<"SAME_THREAD" | "NEW_EMAIL">("SAME_THREAD");
  const [fieldErrors, setFieldErrors] = useState<{
    followUpTemplateId?: string;
    followUpDelayDays?: string;
    followUpSendMode?: string;
    followUpSubject?: string;
  }>({});
  const browserTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York", []);
  const [selectedTimeZone, setSelectedTimeZone] = useState(browserTimeZone);
  const [selectedMappingId, setSelectedMappingId] = useState(() => {
    const firstImportId = props.imports[0]?.id;
    return props.mappings.find((mapping) => mapping.importId === firstImportId)?.id ?? "";
  });
  const timeZoneOptions = useMemo(() => {
    const labels = new Map<string, string>([
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

    return Array.from(new Set([browserTimeZone, ...fallbackTimeZones])).map((timeZone) => ({
      value: timeZone,
      label: labels.get(timeZone) ?? timeZone
    }));
  }, [browserTimeZone]);

  const mappingOptions = useMemo(
    () => props.mappings.filter((mapping) => mapping.importId === selectedImportId),
    [props.mappings, selectedImportId]
  );

  useEffect(() => {
    if (!mappingOptions.length) {
      setSelectedMappingId("");
      return;
    }

    if (!mappingOptions.some((mapping) => mapping.id === selectedMappingId)) {
      setSelectedMappingId(mappingOptions[0]?.id ?? "");
    }
  }, [mappingOptions, selectedMappingId]);

  const selectedImport = props.imports.find((entry) => entry.id === selectedImportId) ?? null;
  const activeMapping = mappingOptions.find((mapping) => mapping.id === selectedMappingId) ?? mappingOptions[0] ?? null;
  useErrorToastEffect(state.error, "Sequence creation failed");

  function formatAttachmentSize(bytes: number) {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    if (bytes >= 1024) {
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }

    return `${bytes} B`;
  }

  function getAttachmentIdentity(file: File) {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }

  function getAttachmentTypeLabel(fileName: string) {
    const extension = fileName.split(".").pop()?.trim().toUpperCase();
    return extension && extension.length <= 5 ? extension : "FILE";
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState({ pending: true });
    const formData = new FormData(form);
    attachments.forEach((attachment) => formData.append("attachments", attachment));
    const scheduleType = String(formData.get("scheduleType"));
    const scheduleTimeZone = String(formData.get("scheduleTimeZone") || browserTimeZone);
    const autoLaunch = scheduleType === "immediate";
    const nextFieldErrors: typeof fieldErrors = {};
    let scheduleRule:
      | {
          type: "recurring";
          frequency: FormDataEntryValue | null;
          time: FormDataEntryValue | null;
          timeZone: string;
          daysOfWeek?: number[];
        }
      | {
          type: "once";
          scheduledFor: string;
          timeZone: string;
        }
      | {
          type: "immediate";
        };

    try {
      scheduleRule =
        scheduleType === "recurring"
          ? {
              type: "recurring",
              frequency: formData.get("frequency"),
              time: formData.get("time"),
              timeZone: scheduleTimeZone,
              ...(formData.get("frequency") === "weekly" ? { daysOfWeek: selectedWeekdays } : {})
            }
          : scheduleType === "once"
            ? (() => {
                const scheduledForInput = String(formData.get("scheduledFor") ?? "");
                const scheduledFor = convertScheduledLocalInputToUtc(scheduledForInput, scheduleTimeZone);

                if (Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date()) {
                  throw new Error("Choose a future date and time in the selected timezone.");
                }

                return {
                  type: "once" as const,
                  scheduledFor: scheduledFor.toISOString(),
                  timeZone: scheduleTimeZone
                };
              })()
            : {
                type: "immediate" as const
              };

      formData.set("scheduleRule", JSON.stringify(scheduleRule));
      formData.set("autoLaunch", String(autoLaunch));
      formData.set("followUpEnabled", String(followUpEnabled));
      formData.set("followUpTemplateId", followUpEnabled ? followUpTemplateId : "");
      formData.set("followUpDelayDays", followUpEnabled ? followUpDelayDays : "");
      formData.set("followUpSendMode", followUpEnabled ? followUpSendMode : "");

      if (scheduleRule.type === "recurring" && scheduleRule.frequency === "weekly" && !selectedWeekdays.length) {
        throw new Error("Select at least one day.");
      }

      if (followUpEnabled) {
        const delayDays = Number.parseInt(followUpDelayDays, 10);
        const selectedFollowUpTemplate = props.templates.find((template) => template.id === followUpTemplateId);

        if (!followUpTemplateId) {
          nextFieldErrors.followUpTemplateId = "Select a follow-up template.";
        }

        if (!Number.isInteger(delayDays) || delayDays < 1) {
          nextFieldErrors.followUpDelayDays = "Enter a delay of at least 1 day.";
        }

        if (!followUpSendMode) {
          nextFieldErrors.followUpSendMode = "Choose how the follow-up should be sent.";
        }

        if (followUpSendMode === "NEW_EMAIL" && !selectedFollowUpTemplate?.subject.trim()) {
          nextFieldErrors.followUpSubject = "New email follow-ups require a subject.";
        }

        if (Object.keys(nextFieldErrors).length) {
          setFieldErrors(nextFieldErrors);
          setState({ pending: false });
          return;
        }
      }

      setFieldErrors({});
    } catch (error) {
      setState({
        pending: false,
        error: error instanceof Error ? error.message : "Choose a valid future send time."
      });
      return;
    }

    const response = await fetch("/api/campaigns", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const payload = await response.json();
      setState({ pending: false, error: payload.error ?? "Campaign creation failed." });
      return;
    }

    form.reset();
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
    setAttachments([]);
    const firstImportId = props.imports[0]?.id ?? "";
    setSelectedImportId(firstImportId);
    setSelectedMappingId(props.mappings.find((mapping) => mapping.importId === firstImportId)?.id ?? "");
    setScheduleType("immediate");
    setFrequency("weekly");
    setSelectedWeekdays([1]);
    setSelectedTimeZone(browserTimeZone);
    setFollowUpEnabled(false);
    setFollowUpTemplateId(props.templates[0]?.id ?? "");
    setFollowUpDelayDays("3");
    setFollowUpSendMode("SAME_THREAD");
    setFieldErrors({});
    router.refresh();
    setState({ pending: false });
  }

  const renderOptions = (options: Option[]) =>
    options.map((option) => (
      <option key={option.id} value={option.id}>
        {option.label}
      </option>
    ));

  const hasSenders = props.senders.length > 0;
  const hasTemplates = props.templates.length > 0;
  const hasImports = props.imports.length > 0;
  const canCreateSequence = hasSenders && hasTemplates && hasImports && Boolean(selectedMappingId);
  const needsReconnect = !hasSenders && (props.disconnectedSenderCount ?? 0) > 0;

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="campaign-name">Sequence name</label>
        <input id="campaign-name" name="name" placeholder="April founder outreach" required />
      </div>
      <div className="field">
        <label htmlFor="importId">Contact list</label>
        <select
          id="importId"
          name="importId"
          value={selectedImportId}
          onChange={(event) => {
            setSelectedImportId(event.target.value);
            setState({ pending: false });
          }}
          required
        >
          <option value="">{hasImports ? "Choose the list you want to send to" : "Upload a list first"}</option>
          {renderOptions(props.imports)}
        </select>
      </div>
      <input type="hidden" name="mappingId" value={selectedMappingId} />
      <div className="surface-note">
        {selectedImport && activeMapping
          ? `Using the saved personalization fields for ${selectedImport.label}.`
          : selectedImport
            ? `${selectedImport.label} still needs its personalization fields set up in Imports before you can send.`
            : "Pick a contact list and we’ll use its saved personalization fields automatically."}
      </div>
      <div className="field">
        <label htmlFor="templateId">Email template</label>
        <select id="templateId" name="templateId" defaultValue={props.templates[0]?.id ?? ""} required>
          <option value="">{hasTemplates ? "Choose the email you want to send" : "Create a template first"}</option>
          {renderOptions(props.templates)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="senderProfileId">Send from</label>
        <select id="senderProfileId" name="senderProfileId" defaultValue={props.senders[0]?.id ?? ""} required disabled={!hasSenders}>
          <option value="">{hasSenders ? "Choose the Gmail account to send from" : needsReconnect ? "Reconnect Gmail first" : "Connect Gmail first"}</option>
          {renderOptions(props.senders)}
        </select>
      </div>
      {needsReconnect ? (
        <div className="surface-note">
          A connected sender is required before this sequence can launch.
          {props.reconnectHref ? (
            <>
              {" "}
              <a href={props.reconnectHref}>Reconnect Gmail</a> to restore sending access.
            </>
          ) : null}
        </div>
      ) : null}
      <div className={styles.followUpComposer}>
        <div className={styles.followUpHeader}>
          <div className={styles.followUpTitle}>
            <MailPlus aria-hidden="true" />
            <label htmlFor="followUpEnabled">Add follow-up email</label>
          </div>
          <input
            id="followUpEnabled"
            name="followUpEnabled"
            type="checkbox"
            checked={followUpEnabled}
            onChange={(event) => {
              setFollowUpEnabled(event.target.checked);
              setFieldErrors({});
            }}
          />
        </div>
        {followUpEnabled ? (
          <div className={styles.followUpGrid}>
            <div className="field">
              <label htmlFor="followUpTemplateId">Follow-up template</label>
              <select
                id="followUpTemplateId"
                name="followUpTemplateId"
                value={followUpTemplateId}
                onChange={(event) => {
                  setFollowUpTemplateId(event.target.value);
                  setFieldErrors((current) => ({ ...current, followUpTemplateId: undefined, followUpSubject: undefined }));
                }}
                aria-invalid={Boolean(fieldErrors.followUpTemplateId)}
              >
                <option value="">{hasTemplates ? "Choose the follow-up email" : "Create a template first"}</option>
                {renderOptions(props.templates)}
              </select>
              {fieldErrors.followUpTemplateId ? <span className={styles.fieldError}>{fieldErrors.followUpTemplateId}</span> : null}
            </div>
            <div className="field">
              <label htmlFor="followUpDelayDays">Send follow-up after</label>
              <div className={styles.delayControl}>
                <input
                  id="followUpDelayDays"
                  name="followUpDelayDays"
                  type="number"
                  min="1"
                  max="60"
                  value={followUpDelayDays}
                  onChange={(event) => {
                    setFollowUpDelayDays(event.target.value);
                    setFieldErrors((current) => ({ ...current, followUpDelayDays: undefined }));
                  }}
                  aria-invalid={Boolean(fieldErrors.followUpDelayDays)}
                />
                <span>days after first email</span>
              </div>
              {fieldErrors.followUpDelayDays ? <span className={styles.fieldError}>{fieldErrors.followUpDelayDays}</span> : null}
            </div>
            <div className={`field ${styles.sendModeField}`}>
              <span className={styles.sendModeLabel}>Send as</span>
              <div className={styles.sendModeGroup}>
                <label className={`${styles.sendModeOption}${followUpSendMode === "SAME_THREAD" ? ` ${styles.sendModeOptionSelected}` : ""}`}>
                  <input
                    type="radio"
                    name="followUpSendMode"
                    value="SAME_THREAD"
                    checked={followUpSendMode === "SAME_THREAD"}
                    onChange={() => {
                      setFollowUpSendMode("SAME_THREAD");
                      setFieldErrors((current) => ({ ...current, followUpSendMode: undefined, followUpSubject: undefined }));
                    }}
                  />
                  <span>Same email thread</span>
                </label>
                <label className={`${styles.sendModeOption}${followUpSendMode === "NEW_EMAIL" ? ` ${styles.sendModeOptionSelected}` : ""}`}>
                  <input
                    type="radio"
                    name="followUpSendMode"
                    value="NEW_EMAIL"
                    checked={followUpSendMode === "NEW_EMAIL"}
                    onChange={() => {
                      setFollowUpSendMode("NEW_EMAIL");
                      setFieldErrors((current) => ({ ...current, followUpSendMode: undefined, followUpSubject: undefined }));
                    }}
                  />
                  <span>New email</span>
                </label>
              </div>
              {fieldErrors.followUpSendMode ? <span className={styles.fieldError}>{fieldErrors.followUpSendMode}</span> : null}
              {fieldErrors.followUpSubject ? <span className={styles.fieldError}>{fieldErrors.followUpSubject}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="attachments">Optional attachments</label>
        <input
          ref={attachmentInputRef}
          id="attachments"
          type="file"
          accept=".pdf,.doc,.docx,.txt,.rtf"
          multiple
          className={styles.hiddenInput}
          onChange={(event) => {
            const selectedFiles = Array.from(event.target.files ?? []);
            if (selectedFiles.length) {
              setAttachments((currentAttachments) => mergeAttachmentFiles(currentAttachments, selectedFiles));
            }
            event.currentTarget.value = "";
          }}
        />
        <div className={styles.attachmentComposer}>
          <div className={styles.attachmentHeader}>
            <div className={styles.attachmentCopy}>
              <span className={styles.attachmentCount}>
                {attachments.length ? `${attachments.length} attachment${attachments.length === 1 ? "" : "s"} ready` : "No attachments yet"}
              </span>
              <p className={styles.attachmentHelp}>Include resumes, cover letters, or supporting documents with every email in this sequence.</p>
            </div>
            <button
              type="button"
              className={`button secondary ${styles.addButton}`}
              onClick={() => attachmentInputRef.current?.click()}
              disabled={state.pending}
            >
              <FilePlus2 aria-hidden="true" />
              Add files
            </button>
          </div>

          {attachments.length ? (
            <div className={styles.attachmentList}>
              {attachments.map((attachment) => (
                <div key={getAttachmentIdentity(attachment)} className={styles.attachmentItem}>
                  <span className={styles.attachmentIcon} aria-hidden="true">
                    <FileText />
                  </span>
                  <div className={styles.attachmentMeta}>
                    <strong className={styles.attachmentName} title={attachment.name}>
                      {attachment.name}
                    </strong>
                    <div className={styles.attachmentDetails}>
                      <span className={styles.attachmentBadge}>{getAttachmentTypeLabel(attachment.name)}</span>
                      <span className={styles.attachmentSize}>{formatAttachmentSize(attachment.size)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.removeButton}
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() =>
                      setAttachments((currentAttachments) =>
                        currentAttachments.filter((file) => getAttachmentIdentity(file) !== getAttachmentIdentity(attachment))
                      )
                    }
                    disabled={state.pending}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <p className={styles.emptyTitle}>No files selected yet.</p>
              <p className={styles.emptyCopy}>Pick files one at a time or select several together. Every new selection stays in the list until you remove it.</p>
            </div>
          )}

          <p className={styles.attachmentFooter}>Supported files: PDF, DOC, DOCX, TXT, and RTF. Each file can be up to 10 MB.</p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="scheduleType">When should this send?</label>
        <select
          id="scheduleType"
          name="scheduleType"
          value={scheduleType}
          onChange={(event) => setScheduleType(event.target.value)}
        >
          <option value="immediate">Right away</option>
          <option value="once">Schedule once</option>
          <option value="recurring">Repeat on a schedule</option>
        </select>
      </div>
      {scheduleType === "once" ? (
        <div className="field">
          <label htmlFor="scheduledFor">Send on</label>
          <input id="scheduledFor" name="scheduledFor" type="datetime-local" required />
        </div>
      ) : null}
      {scheduleType !== "immediate" ? (
        <div className="field">
          <label htmlFor="scheduleTimeZone">Send in timezone</label>
          <select
            id="scheduleTimeZone"
            name="scheduleTimeZone"
            value={selectedTimeZone}
            onChange={(event) => setSelectedTimeZone(event.target.value)}
          >
            {timeZoneOptions.map((timeZone) => (
              <option key={timeZone.value} value={timeZone.value}>
                {timeZone.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {scheduleType === "recurring" ? (
        <>
          <div className="grid cols-3">
            <div className="field">
              <label htmlFor="frequency">Repeat</label>
              <select
                id="frequency"
                name="frequency"
                value={frequency}
                onChange={(event) => setFrequency(event.target.value)}
              >
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="time">Send at</label>
              <input id="time" name="time" type="time" defaultValue="09:00" required />
            </div>
            {frequency === "weekly" ? (
              <div className={`field ${styles.weekdayField}`}>
                <span className={styles.weekdayLabel}>Days</span>
                <div className={styles.weekdayGroup} aria-label="Recurring weekdays">
                  {weekdayOptions.map((day) => {
                    const selected = selectedWeekdays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        className={`${styles.weekdayChip}${selected ? ` ${styles.weekdayChipSelected}` : ""}`}
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedWeekdays((current) =>
                            current.includes(day.value)
                              ? current.filter((value) => value !== day.value)
                              : [...current, day.value].sort((left, right) => left - right)
                          );
                          setState({ pending: false });
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
          <p className="muted" style={{ marginTop: "-0.35rem", marginBottom: 0 }}>
            We’ll keep using this list, template, and sender each time the sequence runs.
          </p>
        </>
      ) : null}
      {scheduleType !== "immediate" ? (
        <p className="muted" style={{ marginTop: scheduleType === "recurring" ? "0.35rem" : "-0.35rem", marginBottom: 0 }}>
          This schedule will run in {selectedTimeZone}.
        </p>
      ) : null}
      <button className="button" type="submit" disabled={state.pending || !canCreateSequence}>
        {state.pending ? "Preparing sequence..." : "Create sequence"}
      </button>
      {!selectedMappingId && selectedImport ? (
        <p className="muted">Finish the personalization fields for this list on the Imports page before creating the sequence.</p>
      ) : null}
    </form>
  );
}
