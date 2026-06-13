"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, Sparkles } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import { renderBrandText } from "@/components/brand-text";
import { useErrorToastEffect } from "@/components/error-toast-provider";
import { analyzeSpam, type SpamAnalysis } from "@/lib/spam-analysis";
import {
  convertTemplateBody,
  getDefaultTemplateBody,
  getTemplateBodyHint,
  getTemplateBodyLabel,
  getTemplateBodyPlaceholder,
  getTemplateFormatLabel,
  TEMPLATE_FORMATS,
  type TemplateFormat,
  validateTemplateBody
} from "@/lib/templates";
import type { MergeVariables } from "@/lib/types";

type ActionState = {
  pending: boolean;
  error?: string;
};

type EnhanceField = "subject" | "body";
const DEFAULT_TEMPLATE_FORMAT: TemplateFormat = "PLAIN_TEXT";

type PasswordFieldProps = {
  id: string;
  label: string;
  name: string;
  autoComplete?: string;
  minLength?: number;
};

export type TemplateDraft = {
  name: string;
  subject: string;
  format: TemplateFormat;
  htmlBody: string;
  previewPayload?: MergeVariables | null;
};

export type EditableTemplate = {
  id: string;
  name: string;
  subject: string;
  format: TemplateFormat;
  htmlBody: string;
  variableManifest: string[];
  previewPayload?: MergeVariables | null;
};

function PasswordField({ id, label, name, autoComplete, minLength }: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const inputType = isVisible ? "text" : "password";
  const actionLabel = isVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input-shell">
        <input id={id} name={name} type={inputType} autoComplete={autoComplete} minLength={minLength} required />
        <button
          aria-label={actionLabel}
          aria-pressed={isVisible}
          className="password-toggle-button"
          type="button"
          onClick={() => setIsVisible((current) => !current)}
        >
          {isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });
  useErrorToastEffect(state.error, "Sign in failed");

  async function readError(response: Response, fallback: string) {
    try {
      const payload = (await response.json()) as { error?: string };
      return payload.error ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState({ pending: true });
    const formData = new FormData(form);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password")
      })
    });

    if (!response.ok) {
      setState({ pending: false, error: await readError(response, "Sign-in failed.") });
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { redirectTo?: "/admin" | "/workspace" };
    router.replace((payload.redirectTo ?? "/workspace") as Route);
    router.refresh();
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
      </div>
      <PasswordField id="password" name="password" label="Password" autoComplete="current-password" />
      <button className="button" type="submit" disabled={state.pending}>
        {state.pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });
  useErrorToastEffect(state.error, "Sign up failed");

  async function readError(response: Response, fallback: string) {
    try {
      const payload = (await response.json()) as { error?: string };
      return payload.error ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState({ pending: true });
    const formData = new FormData(form);
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
        confirmPassword: formData.get("confirmPassword")
      })
    });

    if (!response.ok) {
      setState({ pending: false, error: await readError(response, "Could not create your account.") });
      return;
    }

    router.replace("/workspace");
    router.refresh();
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="signup-email">Email</label>
        <input id="signup-email" name="email" type="email" required />
      </div>
      <PasswordField id="signup-password" name="password" label="Password" autoComplete="new-password" minLength={8} />
      <PasswordField
        id="signup-confirm-password"
        name="confirmPassword"
        label="Confirm password"
        autoComplete="new-password"
        minLength={8}
      />
      <button className="button" type="submit" disabled={state.pending}>
        {state.pending ? "Creating account..." : "Create account"}
      </button>
    </form>
  );
}

export function UploadImportForm() {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });
  useErrorToastEffect(state.error, "Import upload failed");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState({ pending: true });
    const formData = new FormData(form);
    const response = await fetch("/api/imports", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const payload = await response.json();
      setState({ pending: false, error: payload.error ?? "Upload failed." });
      return;
    }

    form.reset();
    setState({ pending: false });
    router.refresh();
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="file">Spreadsheet</label>
        <input id="file" name="file" type="file" accept=".csv,.xls,.xlsx" required />
      </div>
      <button className="button" type="submit" disabled={state.pending}>
        {state.pending ? "Processing..." : "Upload import"}
      </button>
    </form>
  );
}

type TemplateFormProps = {
  initialTemplate?: EditableTemplate | null;
  value?: TemplateDraft;
  onChange?: (fields: TemplateDraft) => void;
  onSaved?: (template: EditableTemplate) => void;
  onCancel?: () => void;
};

function getTemplateFields(template?: EditableTemplate | null): TemplateDraft {
  const format = template?.format ?? DEFAULT_TEMPLATE_FORMAT;
  return {
    name: template?.name ?? "",
    subject: template?.subject ?? "",
    format,
    htmlBody: template?.htmlBody ?? getDefaultTemplateBody(format),
    previewPayload: template?.previewPayload ?? null
  };
}

export function TemplateForm({ initialTemplate = null, value, onChange, onSaved, onCancel }: TemplateFormProps) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });
  const [localFields, setLocalFields] = useState(getTemplateFields(initialTemplate));
  const [enhancingField, setEnhancingField] = useState<EnhanceField | null>(null);
  const [enhanceError, setEnhanceError] = useState<Partial<Record<EnhanceField, string>>>({});
  const [checkingSpam, setCheckingSpam] = useState(false);
  const [spamAnalysis, setSpamAnalysis] = useState<SpamAnalysis | null>(null);
  const [highlightedField, setHighlightedField] = useState<EnhanceField | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const controlled = Boolean(value && onChange);
  const fields = value ?? localFields;
  const bodyValidationError = validateTemplateBody(fields.format, fields.htmlBody);
  useErrorToastEffect(state.error, initialTemplate ? "Template update failed" : "Template save failed");

  const updateFields = (updater: (current: TemplateDraft) => TemplateDraft) => {
    if (controlled && onChange) {
      onChange(updater(fields));
      return;
    }

    setLocalFields(updater);
  };

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  function resetTemplateAssistState() {
    setEnhanceError({});
    setSpamAnalysis(null);
    setHighlightedField(null);

    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
  }

  useEffect(() => {
    if (!controlled) {
      setLocalFields(getTemplateFields(initialTemplate));
    }

    setState({ pending: false });
    resetTemplateAssistState();
  }, [controlled, initialTemplate?.id]);

  async function enhanceText(fieldType: EnhanceField, currentText: string) {
    setEnhanceError((current) => ({
      ...current,
      [fieldType]: undefined
    }));
    setEnhancingField(fieldType);

    try {
      const response = await fetch("/api/templates/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldType,
          currentText,
          templateName: fields.name,
          subjectContext: fieldType === "body" ? fields.subject : undefined,
          bodyContext: fieldType === "subject" ? fields.htmlBody : undefined,
          templateFormat: fieldType === "body" ? fields.format : undefined,
          ...(spamAnalysis ? { spamAnalysis } : {})
        })
      });

      const payload = (await response.json()) as { enhancedText?: string; error?: string };
      if (!response.ok || !payload.enhancedText) {
        setEnhanceError((current) => ({
          ...current,
          [fieldType]: payload.error ?? "AI enhancement failed."
        }));
        return;
      }

      const nextFields = {
        ...fields,
        ...(fieldType === "subject" ? { subject: payload.enhancedText! } : { htmlBody: payload.enhancedText! })
      };

      updateFields((current) => ({
        ...current,
        ...(fieldType === "subject" ? { subject: payload.enhancedText! } : { htmlBody: payload.enhancedText! })
      }));
      const nextAnalysis = await analyzeSpam(nextFields.subject, nextFields.htmlBody, nextFields.format);
      setSpamAnalysis(nextAnalysis);
      setHighlightedField(fieldType);

      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }

      highlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedField(null);
      }, 1600);
    } catch {
      setEnhanceError((current) => ({
        ...current,
        [fieldType]: "AI enhancement failed."
      }));
    } finally {
      setEnhancingField(null);
    }
  }

  async function checkSpam() {
    setCheckingSpam(true);

    try {
      const nextAnalysis = await analyzeSpam(fields.subject, fields.htmlBody, fields.format);
      setSpamAnalysis(nextAnalysis);
    } finally {
      setCheckingSpam(false);
    }
  }

  function getEnhanceTooltip(fieldType: EnhanceField) {
    const hasCurrentText = (fieldType === "subject" ? fields.subject : fields.htmlBody).trim().length > 0;
    const label = fieldType === "subject" ? "subject" : "body";

    if (spamAnalysis) {
      return hasCurrentText ? `Rewrite ${label} using the latest spam check` : `Draft ${label} using the latest spam check`;
    }

    return hasCurrentText ? `Enhance ${label} with AI` : `Draft ${label} with AI`;
  }

  function renderSpamScoreChip(score: number, risk: SpamAnalysis["subjectRisk"]) {
    return <span className={`field-score-chip field-score-chip--${risk.toLowerCase()}`}>{score}% spam</span>;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ pending: true });
    const response = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: initialTemplate?.id,
        name: fields.name,
        subject: fields.subject,
        format: fields.format,
        htmlBody: fields.htmlBody
      })
    });

    if (!response.ok) {
      const payload = await response.json();
      setState({ pending: false, error: payload.error ?? "Template save failed." });
      return;
    }

    const savedTemplate = (await response.json()) as EditableTemplate;
    resetTemplateAssistState();

    if (onSaved) {
      onSaved(savedTemplate);
    } else {
      router.refresh();
    }

    if (!controlled) {
      if (initialTemplate) {
        updateFields(() => getTemplateFields(savedTemplate));
      } else {
        updateFields(() => getTemplateFields(null));
      }
    }

    setState({ pending: false });
  }

  const isEditing = Boolean(initialTemplate);

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="template-form-toolbar">
        <div className="template-form-toolbar__content">
          <p className="template-form-toolbar__eyebrow">Delivery health</p>
          <p className="template-form-toolbar__copy">Run a spam pass whenever you want, then use AI to tighten the copy with that score in mind.</p>
        </div>
        <button
          className={`template-check-spam-button${spamAnalysis ? " is-ready" : ""}`}
          type="button"
          onClick={checkSpam}
          disabled={state.pending || checkingSpam || enhancingField !== null}
        >
          {checkingSpam ? (
            <span className="button-spinner" aria-hidden="true" />
          ) : (
            <span className="template-check-spam-button__signal" aria-hidden="true" />
          )}
          <span className="template-check-spam-button__label">{checkingSpam ? "Checking spam" : "Check spam"}</span>
        </button>
      </div>
      <div className="field">
        <label htmlFor="name">Template name</label>
        <input
          id="name"
          name="name"
          value={fields.name}
          onChange={(event) => updateFields((current) => ({ ...current, name: event.target.value }))}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="format">Message format</label>
        <select
          id="format"
          name="format"
          value={fields.format}
          onChange={(event) => {
            const nextFormat = event.target.value as TemplateFormat;
            setEnhanceError((current) => ({ ...current, body: undefined }));
            setSpamAnalysis(null);

            updateFields((current) => ({
              ...current,
              format: nextFormat,
              htmlBody: convertTemplateBody(current.htmlBody, current.format, nextFormat)
            }));
          }}
        >
          {TEMPLATE_FORMATS.map((format) => (
            <option key={format} value={format}>
              {getTemplateFormatLabel(format)}
            </option>
          ))}
        </select>
        <p className="field-inline-note">{renderBrandText(getTemplateBodyHint(fields.format))}</p>
      </div>
      <div className="field">
        <div className="field-label-row">
          <label htmlFor="subject">Subject</label>
          <div className="field-label-row__actions">
            {spamAnalysis ? renderSpamScoreChip(spamAnalysis.subjectScore, spamAnalysis.subjectRisk) : null}
            <button
              className="field-icon-button"
              type="button"
              onClick={() => enhanceText("subject", fields.subject)}
              disabled={state.pending || enhancingField !== null || checkingSpam}
              aria-label={getEnhanceTooltip("subject")}
              data-tooltip={getEnhanceTooltip("subject")}
            >
              {enhancingField === "subject" ? <span className="button-spinner" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
            </button>
          </div>
        </div>
        <input
          id="subject"
          name="subject"
          value={fields.subject}
          onChange={(event) => {
            setEnhanceError((current) => ({ ...current, subject: undefined }));
            setSpamAnalysis(null);
            updateFields((current) => ({ ...current, subject: event.target.value }));
          }}
          placeholder="Hi {{name}}, quick question"
          className={highlightedField === "subject" ? "field-enhanced" : undefined}
          required
        />
        {enhanceError.subject ? <p className="field-inline-note">{enhanceError.subject}</p> : null}
      </div>
      <div className="field">
        <div className="field-label-row">
          <label htmlFor="htmlBody">{getTemplateBodyLabel(fields.format)}</label>
          <div className="field-label-row__actions">
            {spamAnalysis ? renderSpamScoreChip(spamAnalysis.bodyScore, spamAnalysis.bodyRisk) : null}
            <button
              className="field-icon-button"
              type="button"
              onClick={() => enhanceText("body", fields.htmlBody)}
              disabled={state.pending || enhancingField !== null || checkingSpam}
              aria-label={getEnhanceTooltip("body")}
              data-tooltip={getEnhanceTooltip("body")}
            >
              {enhancingField === "body" ? <span className="button-spinner" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
            </button>
          </div>
        </div>
        <textarea
          id="htmlBody"
          name="htmlBody"
          value={fields.htmlBody}
          placeholder={getTemplateBodyPlaceholder(fields.format)}
          onChange={(event) => {
            setEnhanceError((current) => ({ ...current, body: undefined }));
            setSpamAnalysis(null);
            updateFields((current) => ({ ...current, htmlBody: event.target.value }));
          }}
          className={highlightedField === "body" ? "field-enhanced" : undefined}
          required
        />
        <p className="field-inline-note">{renderBrandText(getTemplateBodyHint(fields.format))}</p>
        {bodyValidationError ? <p className="field-inline-note">{bodyValidationError}</p> : null}
        {enhanceError.body ? <p className="field-inline-note">{enhanceError.body}</p> : null}
      </div>
      <div className="template-form-actions">
        <button className="button" type="submit" disabled={state.pending || Boolean(bodyValidationError)}>
          {state.pending ? "Saving..." : isEditing ? "Save changes" : "Save template"}
        </button>
        {isEditing ? (
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              resetTemplateAssistState();
              onCancel?.();
            }}
            disabled={state.pending}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function SuppressionForm() {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });
  useErrorToastEffect(state.error, "Suppression save failed");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState({ pending: true });
    const formData = new FormData(form);
    const response = await fetch("/api/suppressions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        reason: formData.get("reason"),
        notes: formData.get("notes")
      })
    });

    if (!response.ok) {
      const payload = await response.json();
      setState({ pending: false, error: payload.error ?? "Could not save suppression." });
      return;
    }

    form.reset();
    router.refresh();
    setState({ pending: false });
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="suppression-email">Email</label>
        <input id="suppression-email" name="email" type="email" required />
      </div>
      <div className="field">
        <label htmlFor="reason">Reason</label>
        <select id="reason" name="reason" defaultValue="MANUAL_BLOCK">
          <option value="MANUAL_BLOCK">Manual block</option>
          <option value="INVALID_EMAIL">Invalid email</option>
          <option value="UNSUBSCRIBED">Unsubscribed</option>
          <option value="COMPLAINT">Complaint</option>
          <option value="HARD_BOUNCE">Hard bounce</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" />
      </div>
      <button className="button" type="submit" disabled={state.pending}>
        {state.pending ? "Saving..." : "Add suppression"}
      </button>
    </form>
  );
}
