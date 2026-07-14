"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  Clock3,
  FilePlus2,
  FileText,
  Mail,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  Users
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { useErrorToast, useErrorToastEffect } from "@/components/error-toast-provider";
import {
  BounceMonitoringStatus,
  type BounceMonitoringStatusKind
} from "@/components/senders/bounce-monitoring-status";
import { SequenceLimitDialog } from "@/components/sequence-limit-dialog";
import {
  DEFAULT_AUDIENCE_LIMIT,
  WIZARD_STEPS,
  filterAudienceOptions,
  filterTemplateOptions,
  isAudienceStepComplete,
  isTimingStepComplete,
  type AudienceOption,
  type TemplateOption,
  type WizardStep
} from "@/components/campaign-builder-wizard";
import { mergeAttachmentFiles } from "@/lib/campaign-attachments";
import { convertScheduledLocalInputToUtc, fallbackTimeZones } from "@/lib/schedule";
import {
  SEQUENCE_CONCURRENCY_LIMIT_CODE,
  SEQUENCE_STORAGE_LIMIT_CODE
} from "@/lib/sequence-limit-codes";
import styles from "./campaign-builder.module.css";

type Option = {
  id: string;
  label: string;
};

type MappingOption = Option & {
  importId: string;
};

type SenderOption = Option & {
  name: string;
  email: string;
  status: BounceMonitoringStatusKind;
  backfillCompleted: boolean;
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

const timingOptions = [
  {
    value: "immediate",
    title: "Right away",
    description: "Start sending as soon as the sequence is created."
  },
  {
    value: "once",
    title: "Schedule once",
    description: "Choose one future date and time for launch."
  },
  {
    value: "recurring",
    title: "Repeat on a schedule",
    description: "Run this sequence daily or on selected weekdays."
  }
] as const;

const DEFAULT_BROWSER_TIME_ZONE = "America/New_York";
const contactCountFormatter = new Intl.NumberFormat("en-US");

function readBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_BROWSER_TIME_ZONE;
  } catch {
    return DEFAULT_BROWSER_TIME_ZONE;
  }
}

export function CampaignBuilder(props: {
  imports: AudienceOption[];
  mappings: MappingOption[];
  templates: TemplateOption[];
  senders: SenderOption[];
  disconnectedSenderCount?: number;
  reconnectHref?: string;
}) {
  const router = useRouter();
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const audienceSelectorRef = useRef<HTMLDivElement | null>(null);
  const audienceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const audienceSearchRef = useRef<HTMLInputElement | null>(null);
  const hasMountedRef = useRef(false);
  const { showSuccess } = useErrorToast();
  const [state, setState] = useState<{ pending: boolean; error?: string }>({ pending: false });
  const [activeStep, setActiveStep] = useState<WizardStep>(0);
  const [sequenceName, setSequenceName] = useState("");
  const [audienceQuery, setAudienceQuery] = useState("");
  const [audienceMenuOpen, setAudienceMenuOpen] = useState(false);
  const [templateQuery, setTemplateQuery] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [selectedImportId, setSelectedImportId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedSenderId, setSelectedSenderId] = useState(props.senders[0]?.id ?? "");
  const [scheduleType, setScheduleType] = useState("immediate");
  const [scheduledFor, setScheduledFor] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [sendTime, setSendTime] = useState("09:00");
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([1]);
  const [browserTimeZone, setBrowserTimeZone] = useState(DEFAULT_BROWSER_TIME_ZONE);
  const [selectedTimeZone, setSelectedTimeZone] = useState(DEFAULT_BROWSER_TIME_ZONE);
  const [limitDialog, setLimitDialog] = useState<"concurrency" | "storage" | null>(null);
  const [limitCampaignId, setLimitCampaignId] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedMappingId, setSelectedMappingId] = useState("");

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
  const filteredAudiences = useMemo(
    () => filterAudienceOptions(props.imports, audienceQuery),
    [audienceQuery, props.imports]
  );
  const filteredTemplates = useMemo(
    () => filterTemplateOptions(props.templates, templateQuery),
    [props.templates, templateQuery]
  );

  useEffect(() => {
    const nextTimeZone = readBrowserTimeZone();
    setBrowserTimeZone(nextTimeZone);
    setSelectedTimeZone((current) => (current === DEFAULT_BROWSER_TIME_ZONE ? nextTimeZone : current));
  }, []);

  useEffect(() => {
    if (!mappingOptions.length) {
      setSelectedMappingId("");
      return;
    }

    if (!mappingOptions.some((mapping) => mapping.id === selectedMappingId)) {
      setSelectedMappingId(mappingOptions[0]?.id ?? "");
    }
  }, [mappingOptions, selectedMappingId]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    stepHeadingRef.current?.focus();
  }, [activeStep]);

  useEffect(() => {
    if (!audienceMenuOpen) return;

    audienceSearchRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !audienceSelectorRef.current?.contains(event.target)) {
        setAudienceMenuOpen(false);
        setAudienceQuery("");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [audienceMenuOpen]);

  const selectedImport = props.imports.find((entry) => entry.id === selectedImportId) ?? null;
  const selectedTemplate = props.templates.find((entry) => entry.id === selectedTemplateId) ?? null;
  const selectedSender = props.senders.find((entry) => entry.id === selectedSenderId) ?? null;
  const activeMapping = mappingOptions.find((mapping) => mapping.id === selectedMappingId) ?? mappingOptions[0] ?? null;
  const hasSenders = props.senders.length > 0;
  const hasTemplates = props.templates.length > 0;
  const hasImports = props.imports.length > 0;
  const hasAudienceQuery = Boolean(audienceQuery.trim());
  const hasOlderAudiences = props.imports.length > DEFAULT_AUDIENCE_LIMIT;
  const needsReconnect = !hasSenders && (props.disconnectedSenderCount ?? 0) > 0;
  const audienceStepComplete = isAudienceStepComplete(sequenceName, selectedImportId, selectedMappingId);
  const timingStepComplete = isTimingStepComplete({
    scheduleType,
    scheduledFor,
    sendTime,
    frequency,
    selectedWeekdays
  });
  const canCreateSequence = audienceStepComplete && Boolean(selectedTemplateId && selectedSenderId) && timingStepComplete;

  useErrorToastEffect(state.error, "Sequence creation failed");

  const timingSummary =
    scheduleType === "immediate"
      ? "Starts sending right after you create it."
      : scheduleType === "once"
        ? `Sends once at the chosen time in ${selectedTimeZone}.`
        : `Repeats ${frequency === "daily" ? "every day" : "weekly"} in ${selectedTimeZone}.`;

  function toggleAudienceMenu() {
    if (audienceMenuOpen) {
      setAudienceMenuOpen(false);
      setAudienceQuery("");
      return;
    }

    setAudienceMenuOpen(true);
  }

  function closeAudienceMenu(restoreFocus = false) {
    setAudienceMenuOpen(false);
    setAudienceQuery("");
    if (restoreFocus) {
      requestAnimationFrame(() => audienceTriggerRef.current?.focus());
    }
  }

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

  function changeStep(nextStep: WizardStep) {
    setState({ pending: false });
    setActiveStep(nextStep);
  }

  function canOpenStep(step: WizardStep) {
    if (step <= activeStep) return true;
    if (step !== activeStep + 1) return false;
    if (step === 1) return audienceStepComplete;
    if (step === 2) return audienceStepComplete && Boolean(selectedTemplateId);
    return audienceStepComplete && Boolean(selectedTemplateId) && timingStepComplete;
  }

  function resetBuilder() {
    setSequenceName("");
    setAudienceQuery("");
    setAudienceMenuOpen(false);
    setTemplateQuery("");
    setAttachments([]);
    setSelectedImportId("");
    setSelectedMappingId("");
    setSelectedTemplateId("");
    setSelectedSenderId(props.senders[0]?.id ?? "");
    setScheduleType("immediate");
    setScheduledFor("");
    setFrequency("weekly");
    setSendTime("09:00");
    setSelectedWeekdays([1]);
    setSelectedTimeZone(browserTimeZone);
    setActiveStep(0);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canCreateSequence) {
      setState({ pending: false, error: "Complete each step and connect a Gmail sender before creating the sequence." });
      return;
    }

    const form = event.currentTarget;
    setState({ pending: true });
    const formData = new FormData(form);
    attachments.forEach((attachment) => formData.append("attachments", attachment));
    const submittedScheduleType = String(formData.get("scheduleType"));
    const scheduleTimeZone = String(formData.get("scheduleTimeZone") || browserTimeZone);
    const autoLaunch = submittedScheduleType === "immediate";
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
        submittedScheduleType === "recurring"
          ? {
              type: "recurring",
              frequency: formData.get("frequency"),
              time: formData.get("time"),
              timeZone: scheduleTimeZone,
              ...(formData.get("frequency") === "weekly" ? { daysOfWeek: selectedWeekdays } : {})
            }
          : submittedScheduleType === "once"
            ? (() => {
                const scheduledForInput = String(formData.get("scheduledFor") ?? "");
                const scheduledDate = convertScheduledLocalInputToUtc(scheduledForInput, scheduleTimeZone);

                if (Number.isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
                  throw new Error("Choose a future date and time in the selected timezone.");
                }

                return {
                  type: "once" as const,
                  scheduledFor: scheduledDate.toISOString(),
                  timeZone: scheduleTimeZone
                };
              })()
            : {
                type: "immediate" as const
              };

      formData.set("scheduleRule", JSON.stringify(scheduleRule));
      formData.set("autoLaunch", String(autoLaunch));

      if (scheduleRule.type === "recurring" && scheduleRule.frequency === "weekly" && !selectedWeekdays.length) {
        throw new Error("Select at least one day.");
      }
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
      if (payload.code === SEQUENCE_STORAGE_LIMIT_CODE) {
        setLimitDialog("storage");
        setState({ pending: false });
        return;
      }
      if (payload.code === SEQUENCE_CONCURRENCY_LIMIT_CODE && typeof payload.campaignId === "string") {
        form.reset();
        resetBuilder();
        setLimitCampaignId(payload.campaignId);
        setLimitDialog("concurrency");
        setState({ pending: false });
        router.refresh();
        return;
      }
      setState({ pending: false, error: payload.error ?? "Campaign creation failed." });
      return;
    }

    form.reset();
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
    resetBuilder();
    router.refresh();
    setState({ pending: false });
  }

  async function waitForSlot() {
    if (!limitCampaignId || queueing) return;
    setQueueing(true);
    setQueueError(null);
    try {
      const response = await fetch(`/api/campaigns/${limitCampaignId}/wait-for-slot`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setQueueError(payload.error ?? "Could not queue this sequence.");
        setQueueing(false);
        return;
      }
      setLimitDialog(null);
      setQueueing(false);
      showSuccess(
        payload.status === "STARTED"
          ? "A slot became available and the sequence started."
          : "Sequence queued. It will start automatically when a slot becomes available."
      );
      router.refresh();
    } catch {
      setQueueError("Could not queue this sequence.");
      setQueueing(false);
    }
  }

  return (
    <>
      <form className={styles.builder} onSubmit={onSubmit}>
        <input type="hidden" name="name" value={sequenceName} />
        <input type="hidden" name="importId" value={selectedImportId} />
        <input type="hidden" name="mappingId" value={selectedMappingId} />
        <input type="hidden" name="templateId" value={selectedTemplateId} />
        <input type="hidden" name="senderProfileId" value={selectedSenderId} />
        <input type="hidden" name="scheduleType" value={scheduleType} />
        <input type="hidden" name="scheduledFor" value={scheduledFor} />
        <input type="hidden" name="scheduleTimeZone" value={selectedTimeZone} />
        <input type="hidden" name="frequency" value={frequency} />
        <input type="hidden" name="time" value={sendTime} />

        <div className={styles.wizardLayout}>
          <article className={styles.wizardCard} id="create-sequence">
            <nav className={styles.stepNav} aria-label="Sequence creation progress">
              <ol>
                {WIZARD_STEPS.map((step, index) => {
                  const stepIndex = index as WizardStep;
                  const isActive = activeStep === stepIndex;
                  const isComplete = activeStep > stepIndex;

                  return (
                    <li key={step}>
                      <button
                        type="button"
                        className={`${styles.stepButton}${isActive ? ` ${styles.stepButtonActive}` : ""}${isComplete ? ` ${styles.stepButtonComplete}` : ""}`}
                        aria-current={isActive ? "step" : undefined}
                        disabled={!canOpenStep(stepIndex)}
                        onClick={() => changeStep(stepIndex)}
                      >
                        <span className={styles.stepNumber} aria-hidden="true">
                          {isComplete ? <Check /> : index + 1}
                        </span>
                        <span>{step}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            <div className={styles.stepIntro} aria-live="polite">
              <span>Step {activeStep + 1} of {WIZARD_STEPS.length}</span>
              <h2 ref={stepHeadingRef} tabIndex={-1}>
                {activeStep === 0
                  ? "Choose your audience"
                  : activeStep === 1
                    ? "Choose the message"
                    : activeStep === 2
                      ? "Choose launch timing"
                      : "Review and create"}
              </h2>
              <p>
                {activeStep === 0
                  ? "Name the sequence and select the contact list that should receive it."
                  : activeStep === 1
                    ? "Pick the existing template that everyone in this audience will receive."
                    : activeStep === 2
                      ? "Choose when to launch and add any files that should travel with every email."
                      : "Confirm the plan below. Nothing is sent until you create the sequence."}
              </p>
            </div>

            {activeStep === 0 ? (
              <section className={styles.stepContent} aria-label="Audience step">
                <div className="field">
                  <label htmlFor="campaign-name">Sequence name</label>
                  <input
                    id="campaign-name"
                    value={sequenceName}
                    onChange={(event) => {
                      setSequenceName(event.target.value);
                      setState({ pending: false });
                    }}
                    placeholder="April founder outreach"
                    autoComplete="off"
                    required
                  />
                </div>

                <div className={styles.audienceField}>
                  <span className={styles.audienceLabel} id="audience-selector-label">Audience</span>
                  <div
                    className={styles.audienceSelector}
                    ref={audienceSelectorRef}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && audienceMenuOpen) {
                        event.preventDefault();
                        closeAudienceMenu(true);
                      }
                    }}
                  >
                    <button
                      ref={audienceTriggerRef}
                      className={styles.audienceTrigger}
                      type="button"
                      role="combobox"
                      aria-haspopup="listbox"
                      aria-expanded={audienceMenuOpen}
                      aria-controls="audience-options-menu"
                      aria-labelledby="audience-selector-label audience-selector-value"
                      disabled={!hasImports}
                      data-open={audienceMenuOpen || undefined}
                      onClick={toggleAudienceMenu}
                    >
                      <span className={styles.audienceTriggerIcon} aria-hidden="true"><Users /></span>
                      <span className={styles.audienceTriggerCopy}>
                        <strong id="audience-selector-value">
                          {selectedImport?.label ?? (hasImports ? "Choose an audience" : "No audiences available")}
                        </strong>
                        {selectedImport ? (
                          <span className={styles.audienceTriggerMeta}>
                            <span>{contactCountFormatter.format(selectedImport.rowCount)} contacts</span>
                            {selectedImport.mappedFields.slice(0, 2).map((field) => <span key={field}>{field}</span>)}
                            {selectedImport.mappedFields.length > 2 ? (
                              <span>+{selectedImport.mappedFields.length - 2} fields</span>
                            ) : null}
                          </span>
                        ) : (
                          <span>{hasImports ? "Select from your recent contact lists" : "Import a CSV to get started"}</span>
                        )}
                      </span>
                      <ChevronDown className={styles.audienceChevron} aria-hidden="true" />
                    </button>

                    {audienceMenuOpen ? (
                      <div className={styles.audienceMenu} id="audience-options-menu">
                        <div className={styles.audienceMenuSearch}>
                          <Search aria-hidden="true" />
                          <input
                            ref={audienceSearchRef}
                            id="audience-search"
                            type="search"
                            value={audienceQuery}
                            onChange={(event) => setAudienceQuery(event.target.value)}
                            aria-label="Search contact lists"
                            placeholder="Search contact lists"
                            autoComplete="off"
                          />
                        </div>

                        {filteredAudiences.length ? (
                          <div className={styles.audienceOptions} role="listbox" aria-label="Available contact lists">
                            {filteredAudiences.map((audience) => {
                              const selected = audience.id === selectedImportId;

                              return (
                                <button
                                  key={audience.id}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  className={`${styles.audienceOption}${selected ? ` ${styles.audienceOptionSelected}` : ""}`}
                                  onClick={() => {
                                    setSelectedImportId(audience.id);
                                    setState({ pending: false });
                                    closeAudienceMenu(true);
                                  }}
                                >
                                  <span className={styles.audienceOptionCopy}>
                                    <span className={styles.audienceOptionTitle}>
                                      <strong>{audience.label}</strong>
                                      <span>{contactCountFormatter.format(audience.rowCount)} contacts</span>
                                    </span>
                                    <span className={styles.fieldChips}>
                                      {audience.mappedFields.length ? (
                                        audience.mappedFields.slice(0, 3).map((field) => <span key={field}>{field}</span>)
                                      ) : (
                                        <span>No mapped fields</span>
                                      )}
                                    </span>
                                  </span>
                                  <span className={styles.selectionMark} aria-hidden="true">{selected ? <Check /> : null}</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className={styles.audienceNoResults} role="status">
                            <Search aria-hidden="true" />
                            <span><strong>No matching audiences</strong>Try another list name or mapped field.</span>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {!audienceMenuOpen && hasImports && !hasAudienceQuery && hasOlderAudiences ? (
                    <p className={styles.audienceHelper}>
                      Showing latest {DEFAULT_AUDIENCE_LIMIT}. Search to find older lists.
                    </p>
                  ) : null}

                  {!hasImports ? (
                    <div className={styles.audienceEmpty}>
                      <Upload aria-hidden="true" />
                      <span><strong>No contact lists yet</strong>Import a CSV to create your first audience.</span>
                    </div>
                  ) : null}

                  <a className={styles.inlineAction} href="/imports">
                    <Upload aria-hidden="true" />
                    Import or add a new CSV
                  </a>
                </div>

                {selectedImport ? (
                  <p className={styles.builderNote} data-tone={activeMapping ? undefined : "warning"}>
                    {activeMapping ? <Sparkles aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
                    <span>
                      {activeMapping
                        ? `Using the saved personalization fields for ${selectedImport.label}.`
                        : `${selectedImport.label} still needs its personalization fields set up in Imports before you can continue.`}
                    </span>
                  </p>
                ) : null}

                <div className={styles.stepActions}>
                  <a className={`button secondary ${styles.secondaryAction}`} href="/sequences">Cancel</a>
                  <button
                    className={`button ${styles.primaryAction}`}
                    type="button"
                    disabled={!audienceStepComplete}
                    onClick={() => changeStep(1)}
                  >
                    Next
                    <ArrowRight aria-hidden="true" />
                  </button>
                </div>
              </section>
            ) : null}

            {activeStep === 1 ? (
              <section className={styles.stepContent} aria-label="Message step">
                <div className={styles.contextSummary}>
                  <Users aria-hidden="true" />
                  <span><strong>{selectedImport?.label}</strong> · {contactCountFormatter.format(selectedImport?.rowCount ?? 0)} contacts</span>
                </div>

                {hasTemplates ? (
                  <>
                    <div className={`field ${styles.searchField}`}>
                      <label htmlFor="template-search">Search templates</label>
                      <span className={styles.searchControl}>
                        <Search aria-hidden="true" />
                        <input
                          id="template-search"
                          type="search"
                          value={templateQuery}
                          onChange={(event) => setTemplateQuery(event.target.value)}
                          placeholder="Search by name, subject, or content"
                        />
                      </span>
                    </div>

                    <div className={styles.templateList} role="listbox" aria-label="Available email templates">
                      {filteredTemplates.map((template) => {
                        const selected = template.id === selectedTemplateId;

                        return (
                          <button
                            key={template.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={`${styles.templateCard}${selected ? ` ${styles.optionCardSelected}` : ""}`}
                            onClick={() => {
                              setSelectedTemplateId(template.id);
                              setState({ pending: false });
                            }}
                          >
                            <span className={styles.templateHeader}>
                              <span>
                                <strong>{template.label}</strong>
                                <span className={styles.formatBadge}>{template.formatLabel}</span>
                              </span>
                              <span className={styles.selectionMark} aria-hidden="true">{selected ? <Check /> : null}</span>
                            </span>
                            <span className={styles.templateSubject}>{template.subject || "No subject"}</span>
                            <span className={styles.templateSnippet}>{template.snippet}</span>
                          </button>
                        );
                      })}
                    </div>

                    {!filteredTemplates.length ? (
                      <div className={styles.emptyState}>
                        <Search aria-hidden="true" />
                        <strong>No templates match “{templateQuery}”</strong>
                        <span>Try another name, subject, or phrase.</span>
                      </div>
                    ) : null}

                    <a className={styles.inlineAction} href="/templates">
                      <Plus aria-hidden="true" />
                      Create a new template
                    </a>
                  </>
                ) : (
                  <div className={styles.emptyState}>
                    <FileText aria-hidden="true" />
                    <strong>No email templates yet</strong>
                    <span>Create a template before continuing this sequence.</span>
                    <a className="button" href="/templates">Create a template</a>
                  </div>
                )}

                <div className={styles.stepActions}>
                  <button className={`button secondary ${styles.secondaryAction}`} type="button" onClick={() => changeStep(0)}>
                    <ArrowLeft aria-hidden="true" />
                    Back
                  </button>
                  <button
                    className={`button ${styles.primaryAction}`}
                    type="button"
                    disabled={!selectedTemplateId}
                    onClick={() => changeStep(2)}
                  >
                    Next
                    <ArrowRight aria-hidden="true" />
                  </button>
                </div>
              </section>
            ) : null}

            {activeStep === 2 ? (
              <section className={styles.stepContent} aria-label="Timing step">
                <div className={styles.summaryStrip}>
                  <span><Users aria-hidden="true" /><strong>{selectedImport?.label}</strong></span>
                  <span><Mail aria-hidden="true" /><strong>{selectedTemplate?.label}</strong></span>
                </div>

                <fieldset className={styles.timingChoiceGroup}>
                  <legend>When should this send?</legend>
                  <div className={styles.timingChoices}>
                    {timingOptions.map((option) => {
                      const selected = scheduleType === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`${styles.timingChoice}${selected ? ` ${styles.timingChoiceSelected}` : ""}`}
                          aria-pressed={selected}
                          onClick={() => {
                            setScheduleType(option.value);
                            setState({ pending: false });
                          }}
                        >
                          <Clock3 aria-hidden="true" />
                          <strong>{option.title}</strong>
                          <span>{option.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                {scheduleType !== "immediate" ? (
                  <div className={styles.timingFields}>
                    {scheduleType === "once" ? (
                      <div className="field">
                        <label htmlFor="scheduledFor-control">Send on</label>
                        <input
                          id="scheduledFor-control"
                          type="datetime-local"
                          value={scheduledFor}
                          onChange={(event) => setScheduledFor(event.target.value)}
                          required
                        />
                      </div>
                    ) : null}
                    <div className="field">
                      <label htmlFor="scheduleTimeZone-control">Send in timezone</label>
                      <select
                        id="scheduleTimeZone-control"
                        value={selectedTimeZone}
                        onChange={(event) => setSelectedTimeZone(event.target.value)}
                      >
                        {timeZoneOptions.map((timeZone) => (
                          <option key={timeZone.value} value={timeZone.value}>{timeZone.label}</option>
                        ))}
                      </select>
                    </div>
                    {scheduleType === "recurring" ? (
                      <>
                        <div className="field">
                          <label htmlFor="frequency-control">Repeat</label>
                          <select
                            id="frequency-control"
                            value={frequency}
                            onChange={(event) => setFrequency(event.target.value)}
                          >
                            <option value="daily">Every day</option>
                            <option value="weekly">Every week</option>
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="time-control">Send at</label>
                          <input
                            id="time-control"
                            type="time"
                            value={sendTime}
                            onChange={(event) => setSendTime(event.target.value)}
                            required
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}

                {scheduleType === "recurring" && frequency === "weekly" ? (
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
                    <span>
                      <strong>Optional attachments</strong>
                      <small>Included with every email in this sequence.</small>
                    </span>
                    <span className={styles.attachmentCount}>
                      {attachments.length ? `${attachments.length} file${attachments.length === 1 ? "" : "s"}` : "No files yet"}
                    </span>
                    <button
                      type="button"
                      className={styles.addButton}
                      onClick={() => attachmentInputRef.current?.click()}
                      disabled={state.pending}
                    >
                      <FilePlus2 aria-hidden="true" />
                      Add files
                    </button>
                  </div>

                  {attachments.length ? (
                    <ul className={styles.attachmentList}>
                      {attachments.map((attachment) => (
                        <li key={getAttachmentIdentity(attachment)} className={styles.attachmentItem}>
                          <span className={styles.attachmentIcon} aria-hidden="true"><FileText /></span>
                          <span className={styles.attachmentName} title={attachment.name}>{attachment.name}</span>
                          <span className={styles.attachmentMeta}>
                            {getAttachmentTypeLabel(attachment.name)} · {formatAttachmentSize(attachment.size)}
                          </span>
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
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.attachmentEmpty}>No files attached yet — add resumes, cover letters, or supporting documents.</p>
                  )}
                  <p className={styles.attachmentFooter}>PDF, DOC, DOCX, TXT, or RTF · up to 10 MB each</p>
                </div>

                <div className={styles.stepActions}>
                  <button className={`button secondary ${styles.secondaryAction}`} type="button" onClick={() => changeStep(1)}>
                    <ArrowLeft aria-hidden="true" />
                    Back
                  </button>
                  <button
                    className={`button ${styles.primaryAction}`}
                    type="button"
                    disabled={!timingStepComplete}
                    onClick={() => changeStep(3)}
                  >
                    Review
                    <ArrowRight aria-hidden="true" />
                  </button>
                </div>
              </section>
            ) : null}

            {activeStep === 3 ? (
              <section className={styles.stepContent} aria-label="Review step">
                <dl className={styles.reviewList}>
                  <div><dt>Sequence name</dt><dd>{sequenceName}</dd></div>
                  <div><dt>Audience</dt><dd>{selectedImport?.label} · {contactCountFormatter.format(selectedImport?.rowCount ?? 0)} contacts</dd></div>
                  <div><dt>Template</dt><dd>{selectedTemplate?.label} · {selectedTemplate?.formatLabel}</dd></div>
                  <div><dt>Sender email</dt><dd>{selectedSender?.email ?? "Connect a Gmail sender"}</dd></div>
                  <div><dt>Timing</dt><dd>{timingSummary}</dd></div>
                  <div><dt>Attachments</dt><dd>{attachments.length ? `${attachments.length} attached` : "None"}</dd></div>
                </dl>

                {!selectedSender ? (
                  <p className={styles.validationMessage} role="status">
                    <TriangleAlert aria-hidden="true" />
                    Connect a Gmail account in the sender panel before creating this sequence.
                  </p>
                ) : (
                  <p className={styles.readyMessage} role="status">
                    <Check aria-hidden="true" />
                    Ready to create. Your existing launch and validation flow will run next.
                  </p>
                )}

                {state.error ? <p className={styles.validationMessage} role="alert">{state.error}</p> : null}

                <div className={styles.stepActions}>
                  <button className={`button secondary ${styles.secondaryAction}`} type="button" onClick={() => changeStep(2)}>
                    <ArrowLeft aria-hidden="true" />
                    Back
                  </button>
                  <button className={`button ${styles.createButton}`} type="submit" disabled={state.pending || !canCreateSequence}>
                    {state.pending ? "Preparing sequence..." : "Create sequence"}
                  </button>
                </div>
              </section>
            ) : null}
          </article>

          <aside className={styles.senderSelector} aria-label="Sender selection">
            <div className={styles.senderHeading}>
              <span className={styles.senderIcon}><Mail aria-hidden="true" /></span>
              <span>
                <strong>Send from</strong>
                <small>Connected Gmail account</small>
              </span>
            </div>

            {hasSenders ? (
              <>
                <div className="field">
                  <label htmlFor="senderProfileId">Send from</label>
                  <div className={styles.senderSelectShell}>
                    {selectedSender ? (
                      <span className={styles.senderSelectIdentity} aria-hidden="true">
                        <strong>{selectedSender.name}</strong>
                        <span title={selectedSender.email}>{selectedSender.email}</span>
                      </span>
                    ) : null}
                    <ChevronDown className={styles.senderSelectChevron} aria-hidden="true" />
                    <select
                      className={styles.senderNativeSelect}
                      id="senderProfileId"
                      value={selectedSenderId}
                      onChange={(event) => {
                        setSelectedSenderId(event.target.value);
                        setState({ pending: false });
                      }}
                      aria-label="Send from connected Gmail account"
                      title={selectedSender?.email}
                      required
                    >
                      {props.senders.map((sender) => (
                        <option key={sender.id} value={sender.id}>{sender.name} — {sender.email}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {selectedSender ? (
                  <div className={styles.selectedSender}>
                    <span className={styles.connectedRow}>
                      <strong>{selectedSender.name}</strong>
                      <span>Connected</span>
                    </span>
                    <span className={styles.senderEmail} title={selectedSender.email}>{selectedSender.email}</span>
                    <BounceMonitoringStatus
                      key={selectedSender.id}
                      senderId={selectedSender.id}
                      status={selectedSender.status}
                      backfillCompleted={selectedSender.backfillCompleted}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <div className={styles.senderEmpty}>
                <TriangleAlert aria-hidden="true" />
                <strong>{needsReconnect ? "Reconnect Gmail" : "Connect Gmail"}</strong>
                <span>A connected sender is required before this sequence can be created.</span>
              </div>
            )}

            <a
              className={styles.connectAction}
              href={!hasSenders && props.reconnectHref ? props.reconnectHref : "/api/auth/google/connect"}
            >
              <Plus aria-hidden="true" />
              {hasSenders ? "Connect another Gmail" : needsReconnect ? "Reconnect Gmail" : "Connect Gmail"}
            </a>

            <div className={styles.progressSummary}>
              <span className={styles.progressHeader}>
                <strong>Progress</strong>
                <span>{activeStep + 1} / {WIZARD_STEPS.length}</span>
              </span>
              <span className={styles.progressTrack} aria-hidden="true">
                <span style={{ width: `${((activeStep + 1) / WIZARD_STEPS.length) * 100}%` }} />
              </span>
              <ul>
                <li data-complete={audienceStepComplete || undefined}>
                  <span>Audience</span><strong>{selectedImport?.label ?? "Not selected"}</strong>
                </li>
                <li data-complete={Boolean(selectedTemplateId) || undefined}>
                  <span>Message</span><strong>{selectedTemplate?.label ?? "Not selected"}</strong>
                </li>
                <li data-complete={timingStepComplete || undefined}>
                  <span>Timing</span><strong>{timingOptions.find((option) => option.value === scheduleType)?.title}</strong>
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </form>

      <SequenceLimitDialog
        open={limitDialog !== null}
        kind={limitDialog ?? "storage"}
        loading={queueing}
        error={queueError}
        onWaitForSlot={waitForSlot}
        onClose={() => {
          if (!queueing) {
            setLimitDialog(null);
            setQueueError(null);
          }
        }}
      />
    </>
  );
}
