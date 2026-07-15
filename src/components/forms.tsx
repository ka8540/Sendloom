"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bold,
  Braces,
  Check,
  Circle,
  Eye,
  EyeOff,
  Gauge,
  ImageIcon,
  Italic,
  Link,
  List as ListIcon,
  ListOrdered,
  Mail,
  Paperclip,
  Send,
  ShieldCheck,
  Sparkles,
  Strikethrough,
  Video
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import { renderBrandText } from "@/components/brand-text";
import { useErrorToastEffect } from "@/components/error-toast-provider";
import { analyzeSpam, type SpamAnalysis } from "@/lib/spam-analysis";
import {
  applyTemplateComposerCommand,
  insertTemplateAttribute,
  TEMPLATE_COMPOSER_ATTRIBUTES,
  type TemplateComposerCommand,
  type TemplateComposerEdit
} from "@/lib/template-composer";
import {
  buildTemplatePreviewPayload,
  convertTemplateBody,
  extractTemplateVariables,
  getDefaultTemplateBody,
  getTemplateBodyHint,
  getTemplateBodyPlaceholder,
  getTemplateFormatLabel,
  renderTemplatePreview,
  renderTemplateSubjectPreview,
  TEMPLATE_FORMATS,
  templateContentToPlainText,
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
export const TEMPLATE_WIZARD_STEPS = ["Compose", "Optimize", "Preview"] as const;
type TemplateWizardStep = 0 | 1 | 2;

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
  const [activeStep, setActiveStep] = useState<TemplateWizardStep>(0);
  const highlightTimeoutRef = useRef<number | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attributeMenuRef = useRef<HTMLDetailsElement | null>(null);
  const controlled = Boolean(value && onChange);
  const fields = value ?? localFields;
  const bodyValidationError = validateTemplateBody(fields.format, fields.htmlBody);
  const plainTextBody = templateContentToPlainText(fields.format, fields.htmlBody);
  const wordCount = plainTextBody ? plainTextBody.split(/\s+/).filter(Boolean).length : 0;
  const readingSeconds = wordCount ? Math.max(1, Math.ceil((wordCount / 200) * 60)) : 0;
  const readingTime = readingSeconds >= 60 ? `${Math.ceil(readingSeconds / 60)} min` : `${readingSeconds} sec`;
  const overallSpamScore = spamAnalysis ? Math.max(spamAnalysis.subjectScore, spamAnalysis.bodyScore) : null;
  const previewVariables = Array.from(new Set([...extractTemplateVariables(fields.subject), ...extractTemplateVariables(fields.htmlBody)]));
  const previewPayload = buildTemplatePreviewPayload(previewVariables, fields.previewPayload ?? undefined);
  const composeComplete = Boolean(fields.name.trim() && fields.subject.trim() && fields.htmlBody.trim() && !bodyValidationError);
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
    setActiveStep(0);
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

      const payload = (await response.json()) as {
        enhancedText?: string;
        error?: string;
      };
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

  function updateBody(nextBody: string) {
    setEnhanceError((current) => ({ ...current, body: undefined }));
    setSpamAnalysis(null);
    updateFields((current) => ({ ...current, htmlBody: nextBody }));
  }

  function commitComposerEdit(edit: TemplateComposerEdit) {
    updateBody(edit.value);

    window.requestAnimationFrame(() => {
      bodyTextareaRef.current?.focus();
      bodyTextareaRef.current?.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  function runComposerCommand(command: TemplateComposerCommand) {
    const textarea = bodyTextareaRef.current;
    const selectionStart = textarea?.selectionStart ?? fields.htmlBody.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;

    commitComposerEdit(applyTemplateComposerCommand(fields.format, fields.htmlBody, selectionStart, selectionEnd, command));
  }

  function insertAttribute(attribute: string) {
    const textarea = bodyTextareaRef.current;
    const selectionStart = textarea?.selectionStart ?? fields.htmlBody.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;

    commitComposerEdit(insertTemplateAttribute(fields.htmlBody, selectionStart, selectionEnd, attribute));
    attributeMenuRef.current?.removeAttribute("open");
  }

  function changeStep(nextStep: TemplateWizardStep) {
    if (nextStep > 0 && !composeComplete) {
      return;
    }

    setActiveStep(nextStep);
    window.requestAnimationFrame(() => stepHeadingRef.current?.focus());
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
      setState({
        pending: false,
        error: payload.error ?? "Template save failed."
      });
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
  const composerBusy = state.pending || checkingSpam || enhancingField !== null;
  const formattingDisabled = composerBusy || fields.format === "JSON";
  const progressItems = [
    { label: "Template name", complete: Boolean(fields.name.trim()) },
    { label: "Message format", complete: Boolean(fields.format) },
    { label: "Subject", complete: Boolean(fields.subject.trim()) },
    {
      label: "Email body",
      complete: Boolean(fields.htmlBody.trim()) && !bodyValidationError
    },
    { label: "Spam check", complete: Boolean(spamAnalysis) }
  ];
  const spamSignals = spamAnalysis ? Array.from(new Set([...spamAnalysis.subjectSignals, ...spamAnalysis.bodySignals])) : [];

  return (
    <form className="template-wizard" onSubmit={onSubmit}>
      <article className="card template-wizard__card">
        <nav className="template-wizard__steps" aria-label="Template creation progress">
          {TEMPLATE_WIZARD_STEPS.map((step, index) => {
            const stepIndex = index as TemplateWizardStep;
            const isActive = activeStep === stepIndex;
            const isComplete = activeStep > stepIndex;

            return (
              <button
                key={step}
                className={`template-wizard__step${isActive ? " is-active" : ""}${isComplete ? " is-complete" : ""}`}
                type="button"
                onClick={() => changeStep(stepIndex)}
                disabled={stepIndex > 0 && !composeComplete}
                aria-current={isActive ? "step" : undefined}
              >
                <span className="template-wizard__step-number">{isComplete ? <Check aria-hidden="true" /> : index + 1}</span>
                <span>{step}</span>
              </button>
            );
          })}
        </nav>

        <header className="template-wizard__intro">
          <span>
            Step {activeStep + 1} of {TEMPLATE_WIZARD_STEPS.length}
          </span>
          <h2 ref={stepHeadingRef} tabIndex={-1}>
            {activeStep === 0 ? "Compose your template" : activeStep === 1 ? "Optimize your message" : "Review and create"}
          </h2>
          <p>
            {activeStep === 0
              ? "Name the template and write the subject and body your sequences will use."
              : activeStep === 1
                ? "Use AI and a spam pass to tighten the copy before you publish it."
                : "Confirm the final message, variables, and delivery health."}
          </p>
        </header>

        {activeStep === 0 ? (
          <div className="template-wizard__step-content">
            <div className="template-meta-grid">
              <div className="field template-meta-field">
                <label htmlFor="name">Template name</label>
                <input
                  id="name"
                  name="name"
                  value={fields.name}
                  onChange={(event) =>
                    updateFields((current) => ({
                      ...current,
                      name: event.target.value
                    }))
                  }
                  placeholder="e.g. Recruiting intro"
                  required
                />
              </div>
              <div className="field template-meta-field">
                <label htmlFor="format">Message format</label>
                <select
                  id="format"
                  name="format"
                  value={fields.format}
                  onChange={(event) => {
                    const nextFormat = event.target.value as TemplateFormat;
                    setEnhanceError((current) => ({
                      ...current,
                      body: undefined
                    }));
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
              </div>
            </div>
            <p className="template-meta-hint">{renderBrandText(getTemplateBodyHint(fields.format))}</p>

            <section className="template-composer" aria-label="Opening email composer">
              <header className="template-composer__header">
                <div className="template-composer__title">
                  <Mail aria-hidden="true" />
                  <span>Opening email</span>
                </div>
              </header>

              <div className="template-composer__subject">
                <label htmlFor="subject">Subject:</label>
                <input
                  id="subject"
                  name="subject"
                  value={fields.subject}
                  onChange={(event) => {
                    setEnhanceError((current) => ({
                      ...current,
                      subject: undefined
                    }));
                    setSpamAnalysis(null);
                    updateFields((current) => ({
                      ...current,
                      subject: event.target.value
                    }));
                  }}
                  placeholder="Enter your subject line"
                  required
                />
                <span className="template-composer__send-icon" title="Email subject">
                  <Send aria-hidden="true" />
                </span>
              </div>

              <div className="template-composer__body">
                <div className="template-composer__body-prompt">
                  <span>Compose your email</span>
                </div>
                <textarea
                  ref={bodyTextareaRef}
                  id="htmlBody"
                  name="htmlBody"
                  value={fields.htmlBody}
                  placeholder={fields.format === "PLAIN_TEXT" ? "Compose your email" : getTemplateBodyPlaceholder(fields.format)}
                  onChange={(event) => updateBody(event.target.value)}
                  required
                />

                <div className="template-composer__messages" aria-live="polite">
                  {bodyValidationError ? <p>{bodyValidationError}</p> : null}
                </div>

                <div className="template-composer__toolbar" aria-label="Email formatting toolbar">
                  <div className="template-composer__toolbar-group">
                    <button
                      type="button"
                      onClick={() => runComposerCommand("bold")}
                      disabled={formattingDisabled}
                      aria-label="Bold"
                      title={fields.format === "JSON" ? "Formatting is unavailable in structured JSON" : "Bold"}
                    >
                      <Bold aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => runComposerCommand("italic")}
                      disabled={formattingDisabled}
                      aria-label="Italic"
                      title={fields.format === "JSON" ? "Formatting is unavailable in structured JSON" : "Italic"}
                    >
                      <Italic aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => runComposerCommand("strike")}
                      disabled={formattingDisabled}
                      aria-label="Strikethrough"
                      title={fields.format === "JSON" ? "Formatting is unavailable in structured JSON" : "Strikethrough"}
                    >
                      <Strikethrough aria-hidden="true" />
                    </button>
                  </div>

                  <span className="template-composer__toolbar-divider" aria-hidden="true" />

                  <div className="template-composer__toolbar-group">
                    <button
                      type="button"
                      onClick={() => runComposerCommand("bullet-list")}
                      disabled={formattingDisabled}
                      aria-label="Bullet list"
                      title={fields.format === "JSON" ? "Formatting is unavailable in structured JSON" : "Bullet list"}
                    >
                      <ListIcon aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => runComposerCommand("numbered-list")}
                      disabled={formattingDisabled}
                      aria-label="Numbered list"
                      title={fields.format === "JSON" ? "Formatting is unavailable in structured JSON" : "Numbered list"}
                    >
                      <ListOrdered aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => runComposerCommand("link")}
                      disabled={formattingDisabled}
                      aria-label="Insert link"
                      title={fields.format === "JSON" ? "Formatting is unavailable in structured JSON" : "Insert link"}
                    >
                      <Link aria-hidden="true" />
                    </button>
                  </div>

                  <span className="template-composer__toolbar-divider" aria-hidden="true" />

                  <div className="template-composer__toolbar-group">
                    <button
                      type="button"
                      disabled
                      aria-label="Image attachments are not available yet"
                      title="Image attachments are not available yet"
                    >
                      <ImageIcon aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled
                      aria-label="Video attachments are not available yet"
                      title="Video attachments are not available yet"
                    >
                      <Video aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled
                      aria-label="File attachments are not available yet"
                      title="File attachments are not available yet"
                    >
                      <Paperclip aria-hidden="true" />
                    </button>
                  </div>

                  <span className="template-composer__toolbar-divider" aria-hidden="true" />

                  <details className="template-composer__attributes" ref={attributeMenuRef}>
                    <summary>
                      <Braces aria-hidden="true" />
                      <span>Insert attribute</span>
                    </summary>
                    <div className="template-composer__attribute-menu">
                      {TEMPLATE_COMPOSER_ATTRIBUTES.map((attribute) => (
                        <button
                          key={attribute.value}
                          type="button"
                          onClick={() => insertAttribute(attribute.value)}
                          disabled={composerBusy}
                        >
                          <span>{attribute.label}</span>
                          <code>{`{{${attribute.value}}}`}</code>
                        </button>
                      ))}
                    </div>
                  </details>
                </div>
              </div>

              <footer className="template-composer__stats">
                <span>
                  Words: <strong>{wordCount}</strong>
                </span>
                <span>
                  Reading time: <strong>{readingTime}</strong>
                </span>
                <span>
                  Grade: <strong>-</strong>
                </span>
              </footer>
            </section>

            <div className="template-wizard__actions">
              <button className="button secondary" type="button" onClick={onCancel} disabled={state.pending}>
                Cancel
              </button>
              <button className="button" type="button" onClick={() => changeStep(1)} disabled={!composeComplete || state.pending}>
                Next: Optimize
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        {activeStep === 1 ? (
          <div className="template-wizard__step-content">
            <div className="template-optimize-grid">
              <section className="template-optimize-card" aria-labelledby="ai-assistant-heading">
                <div className="template-optimize-card__heading">
                  <span className="template-optimize-card__icon">
                    <Sparkles aria-hidden="true" />
                  </span>
                  <div>
                    <h3 id="ai-assistant-heading">AI copy assistant</h3>
                    <p>Draft or polish one field at a time while preserving your format and merge fields.</p>
                  </div>
                </div>
                <div className={`template-optimize-card__field${highlightedField === "subject" ? " field-enhanced" : ""}`}>
                  <span>Subject</span>
                  <strong>{fields.subject}</strong>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => enhanceText("subject", fields.subject)}
                    disabled={composerBusy}
                    title={getEnhanceTooltip("subject")}
                  >
                    {enhancingField === "subject" ? (
                      <span className="button-spinner" aria-hidden="true" />
                    ) : (
                      <Sparkles aria-hidden="true" />
                    )}
                    Improve subject
                  </button>
                  {enhanceError.subject ? <p className="template-optimize-card__error">{enhanceError.subject}</p> : null}
                </div>
                <div className={`template-optimize-card__field${highlightedField === "body" ? " field-enhanced" : ""}`}>
                  <span>Email body</span>
                  <strong>
                    {wordCount} words · {readingTime} read
                  </strong>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => enhanceText("body", fields.htmlBody)}
                    disabled={composerBusy}
                    title={getEnhanceTooltip("body")}
                  >
                    {enhancingField === "body" ? <span className="button-spinner" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                    Improve body
                  </button>
                  {enhanceError.body ? <p className="template-optimize-card__error">{enhanceError.body}</p> : null}
                </div>
              </section>

              <section className="template-optimize-card" aria-labelledby="spam-check-heading">
                <div className="template-optimize-card__heading">
                  <span className="template-optimize-card__icon">
                    <ShieldCheck aria-hidden="true" />
                  </span>
                  <div>
                    <h3 id="spam-check-heading">Spam check</h3>
                    <p>Scan the subject and body for common signals that can hurt deliverability.</p>
                  </div>
                </div>
                <button
                  className="button secondary template-optimize-card__check"
                  type="button"
                  onClick={checkSpam}
                  disabled={composerBusy}
                >
                  {checkingSpam ? <span className="button-spinner" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
                  {checkingSpam ? "Checking message..." : spamAnalysis ? "Check again" : "Run spam check"}
                </button>

                {spamAnalysis ? (
                  <div className="template-spam-results" aria-live="polite">
                    <div className="template-spam-results__scores">
                      <div>
                        <span>Subject</span>
                        {renderSpamScoreChip(spamAnalysis.subjectScore, spamAnalysis.subjectRisk)}
                      </div>
                      <div>
                        <span>Body</span>
                        {renderSpamScoreChip(spamAnalysis.bodyScore, spamAnalysis.bodyRisk)}
                      </div>
                    </div>
                    {spamSignals.length ? (
                      <ul>
                        {spamSignals.map((signal) => (
                          <li key={signal}>{signal}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No common spam signals found. The message is in good shape.</p>
                    )}
                  </div>
                ) : (
                  <div className="template-spam-empty">
                    <Gauge aria-hidden="true" />
                    <p>Your delivery health results will appear here after a check.</p>
                  </div>
                )}
              </section>
            </div>

            <div className="template-copy-health" aria-label="Copy health summary">
              <div>
                <span>Words</span>
                <strong>{wordCount}</strong>
              </div>
              <div>
                <span>Reading time</span>
                <strong>{readingTime}</strong>
              </div>
              <div>
                <span>Variables</span>
                <strong>{previewVariables.length}</strong>
              </div>
              <div>
                <span>Spam score</span>
                <strong>{overallSpamScore === null ? "Not checked" : `${overallSpamScore}%`}</strong>
              </div>
            </div>

            <div className="template-wizard__actions">
              <button className="button secondary" type="button" onClick={() => changeStep(0)} disabled={state.pending}>
                <ArrowLeft aria-hidden="true" />
                Back
              </button>
              <button className="button" type="button" onClick={() => changeStep(2)} disabled={state.pending}>
                Next: Preview
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        {activeStep === 2 ? (
          <div className="template-wizard__step-content template-wizard-preview">
            <div className="template-wizard-preview__summary" aria-label="Template summary">
              <div>
                <span>Template</span>
                <strong>{fields.name}</strong>
              </div>
              <div>
                <span>Format</span>
                <strong>{getTemplateFormatLabel(fields.format)}</strong>
              </div>
              <div>
                <span>Spam score</span>
                <strong>{overallSpamScore === null ? "Not checked" : `${overallSpamScore}%`}</strong>
              </div>
            </div>

            <section className="template-wizard-preview__surface" aria-labelledby="email-preview-heading">
              <div className="template-wizard-preview__surface-heading">
                <div>
                  <span>Final message</span>
                  <h3 id="email-preview-heading">Email preview</h3>
                </div>
                <span className="format-badge">{getTemplateFormatLabel(fields.format)}</span>
              </div>
              <div className="template-preview-mail template-wizard-preview__mail">
                <span className="template-preview-mail__eyebrow">Subject</span>
                <h4>{renderTemplateSubjectPreview(fields.subject, previewPayload)}</h4>
                <div
                  className={`template-preview-mail__body template-preview-mail__body--${fields.format.toLowerCase().replace("_", "-")}`}
                  dangerouslySetInnerHTML={{
                    __html: renderTemplatePreview(fields.format, fields.htmlBody, previewPayload)
                  }}
                />
              </div>
            </section>

            <div className="template-wizard-preview__variables">
              <span>Variables</span>
              <div className="pill-row">
                {(previewVariables.length ? previewVariables : ["None detected"]).map((variable) => (
                  <span key={variable} className="pill">
                    {variable}
                  </span>
                ))}
              </div>
            </div>

            {state.error ? (
              <p className="error-message" role="alert">
                {state.error}
              </p>
            ) : null}

            <div className="template-wizard__actions">
              <button className="button secondary" type="button" onClick={() => changeStep(1)} disabled={state.pending}>
                <ArrowLeft aria-hidden="true" />
                Back
              </button>
              <button className="button" type="submit" disabled={state.pending || Boolean(bodyValidationError)}>
                {state.pending ? "Saving..." : isEditing ? "Save changes" : "Create template"}
              </button>
            </div>
          </div>
        ) : null}
      </article>

      <aside className="card template-wizard__progress" aria-label="Template progress">
        <span className="template-wizard__progress-kicker">Progress</span>
        <div className="template-wizard__progress-heading">
          <strong>
            {activeStep + 1} of {TEMPLATE_WIZARD_STEPS.length}
          </strong>
          <span>{Math.round(((activeStep + 1) / TEMPLATE_WIZARD_STEPS.length) * 100)}%</span>
        </div>
        <div className="template-wizard__progress-track" aria-hidden="true">
          <span
            style={{
              width: `${((activeStep + 1) / TEMPLATE_WIZARD_STEPS.length) * 100}%`
            }}
          />
        </div>
        <ul className="template-wizard__checklist">
          {progressItems.map((item) => (
            <li key={item.label} className={item.complete ? "is-complete" : undefined}>
              {item.complete ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
        <p>Complete the message details first. Optimization is recommended, but you can create the template without a spam check.</p>
      </aside>
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
