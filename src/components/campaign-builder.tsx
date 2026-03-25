"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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
}) {
  const router = useRouter();
  const [state, setState] = useState<{ pending: boolean; error?: string }>({ pending: false });
  const [selectedImportId, setSelectedImportId] = useState(props.imports[0]?.id ?? "");
  const [selectedMappingId, setSelectedMappingId] = useState(() => {
    const firstImportId = props.imports[0]?.id;
    return props.mappings.find((mapping) => mapping.importId === firstImportId)?.id ?? "";
  });

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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState({ pending: true });
    const formData = new FormData(form);
    const scheduleType = String(formData.get("scheduleType"));
    const scheduleRule =
      scheduleType === "recurring"
        ? {
            type: "recurring",
            frequency: formData.get("frequency"),
            time: formData.get("time"),
            dayOfWeek: Number(formData.get("dayOfWeek"))
          }
        : scheduleType === "once"
          ? {
              type: "once",
              scheduledFor: formData.get("scheduledFor")
            }
        : {
            type: "immediate"
          };
    const autoLaunch = scheduleType === "immediate";

    formData.set("scheduleRule", JSON.stringify(scheduleRule));
    formData.set("autoLaunch", String(autoLaunch));

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

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="campaign-name">Sequence name</label>
        <input id="campaign-name" name="name" placeholder="April founder outreach" required />
      </div>
      <div className="field">
        <label htmlFor="importId">Audience</label>
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
          <option value="">Select an uploaded list</option>
          {renderOptions(props.imports)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="mappingId">Auto-detected fields</label>
        <select
          id="mappingId"
          name="mappingId"
          value={selectedMappingId}
          onChange={(event) => setSelectedMappingId(event.target.value)}
          required
          disabled={!mappingOptions.length}
        >
          <option value="">{mappingOptions.length ? "Select the field set for this audience" : "No field set for this audience yet"}</option>
          {renderOptions(mappingOptions)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="templateId">Template</label>
        <select id="templateId" name="templateId" defaultValue={props.templates[0]?.id ?? ""} required>
          <option value="">Select a template</option>
          {renderOptions(props.templates)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="senderProfileId">Connected sender</label>
        <select id="senderProfileId" name="senderProfileId" defaultValue={props.senders[0]?.id ?? ""} required disabled={!hasSenders}>
          <option value="">{hasSenders ? "Select a connected Gmail sender" : "Connect Gmail first"}</option>
          {renderOptions(props.senders)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="attachment">Attachment</label>
        <input id="attachment" name="attachment" type="file" accept=".pdf,.doc,.docx,.txt,.rtf" />
      </div>
      <div className="field">
        <label htmlFor="scheduleType">Delivery mode</label>
        <select id="scheduleType" name="scheduleType" defaultValue="immediate">
          <option value="immediate">Send now</option>
          <option value="once">One-time scheduled</option>
          <option value="recurring">Recurring</option>
        </select>
      </div>
      <div className="grid cols-3">
        <div className="field">
          <label htmlFor="scheduledFor">Scheduled for</label>
          <input id="scheduledFor" name="scheduledFor" type="datetime-local" />
        </div>
        <div className="field">
          <label htmlFor="frequency">Frequency</label>
          <select id="frequency" name="frequency" defaultValue="weekly">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="time">Recurring time</label>
          <input id="time" name="time" type="time" defaultValue="09:00" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="dayOfWeek">Recurring day of week</label>
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
      <button className="button" type="submit" disabled={state.pending || !hasSenders}>
        {state.pending ? "Preparing sequence..." : "Create sequence"}
      </button>
      {state.error ? <p className="muted">{state.error}</p> : null}
    </form>
  );
}
