"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { useErrorToastEffect } from "@/components/error-toast-provider";
import { convertScheduledLocalInputToUtc, fallbackTimeZones } from "@/lib/schedule";

type Option = {
  id: string;
  label: string;
};

type MappingOption = Option & {
  importId: string;
};

export function CampaignBuilder(props: {
  imports: Option[];
  mappings: MappingOption[];
  templates: Option[];
  senders: Option[];
  disconnectedSenderCount?: number;
  reconnectHref?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<{ pending: boolean; error?: string }>({ pending: false });
  const [selectedImportId, setSelectedImportId] = useState(props.imports[0]?.id ?? "");
  const [scheduleType, setScheduleType] = useState("immediate");
  const [frequency, setFrequency] = useState("weekly");
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState({ pending: true });
    const formData = new FormData(form);
    const scheduleType = String(formData.get("scheduleType"));
    const scheduleTimeZone = String(formData.get("scheduleTimeZone") || browserTimeZone);
    const autoLaunch = scheduleType === "immediate";
    let scheduleRule:
      | {
          type: "recurring";
          frequency: FormDataEntryValue | null;
          time: FormDataEntryValue | null;
          timeZone: string;
          dayOfWeek?: number;
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
              ...(formData.get("frequency") === "weekly" ? { dayOfWeek: Number(formData.get("dayOfWeek")) } : {})
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
    const firstImportId = props.imports[0]?.id ?? "";
    setSelectedImportId(firstImportId);
    setSelectedMappingId(props.mappings.find((mapping) => mapping.importId === firstImportId)?.id ?? "");
    setScheduleType("immediate");
    setFrequency("weekly");
    setSelectedTimeZone(browserTimeZone);
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
      <div className="field">
        <label htmlFor="attachment">Optional attachment</label>
        <input id="attachment" name="attachment" type="file" accept=".pdf,.doc,.docx,.txt,.rtf" />
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
              <div className="field">
                <label htmlFor="dayOfWeek">Day</label>
                <select id="dayOfWeek" name="dayOfWeek" defaultValue="1">
                  <option value="0">Sunday</option>
                  <option value="1">Monday</option>
                  <option value="2">Tuesday</option>
                  <option value="3">Wednesday</option>
                  <option value="4">Thursday</option>
                  <option value="5">Friday</option>
                  <option value="6">Saturday</option>
                </select>
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
