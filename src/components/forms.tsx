"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Mail,
  Sparkles,
  UploadCloud
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { renderBrandText } from "@/components/brand-text";
import { useErrorToastEffect } from "@/components/error-toast-provider";
import importStyles from "@/components/imports-workflow.module.css";
import {
  OtpVerificationForm,
  type OtpChallengeMetadata
} from "@/components/otp-verification-form";
import { analyzeSpam, type SpamAnalysis } from "@/lib/spam-analysis";
import {
  buildTemplatePreviewPayload,
  convertTemplateBody,
  extractTemplateVariables,
  getDefaultTemplateBody,
  getTemplateBodyHint,
  getTemplateBodyLabel,
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

async function readError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? fallback;
  } catch {
    return fallback;
  }
}

type EnhanceField = "subject" | "body";
const DEFAULT_TEMPLATE_FORMAT: TemplateFormat = "PLAIN_TEXT";
export const TEMPLATE_WIZARD_STEPS = ["Compose", "Preview / Review"] as const;
type TemplateWizardStep = 0 | 1;

type PasswordFieldProps = {
  id: string;
  label: string;
  name: string;
  autoComplete?: string;
  minLength?: number;
  labelAction?: ReactNode;
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

function PasswordField({ id, label, name, autoComplete, minLength, labelAction }: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const inputType = isVisible ? "text" : "password";
  const actionLabel = isVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`;

  return (
    <div className="field">
      {labelAction ? (
        <div className="field-label-row">
          <label htmlFor={id}>{label}</label>
          <span className="field-label-row__actions">{labelAction}</span>
        </div>
      ) : (
        <label htmlFor={id}>{label}</label>
      )}
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
      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="current-password"
        labelAction={
          <Link className="auth-recovery-link" href={"/forgot-password" as Route}>
            Forgot password?
          </Link>
        }
      />
      <button className="button" type="submit" disabled={state.pending}>
        {state.pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });
  const [challenge, setChallenge] = useState<OtpChallengeMetadata | null>(null);
  useErrorToastEffect(state.error, "Sign up failed");

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

    const payload = (await response.json().catch(() => null)) as
      | (Partial<OtpChallengeMetadata> & { error?: string; requiresVerification?: boolean })
      | null;

    if (!response.ok) {
      setState({ pending: false, error: payload?.error ?? "Could not start account verification." });
      return;
    }

    if (
      !payload?.requiresVerification ||
      typeof payload.challengeId !== "string" ||
      typeof payload.maskedEmail !== "string" ||
      typeof payload.expiresInSeconds !== "number" ||
      typeof payload.resendAvailableInSeconds !== "number"
    ) {
      setState({ pending: false, error: "Could not start account verification." });
      return;
    }

    setChallenge({
      challengeId: payload.challengeId,
      maskedEmail: payload.maskedEmail,
      expiresInSeconds: payload.expiresInSeconds,
      resendAvailableInSeconds: payload.resendAvailableInSeconds
    });
    setState({ pending: false });
  }

  if (challenge) {
    return (
      <OtpVerificationForm
        challenge={challenge}
        verifyEndpoint="/api/auth/signup/verify"
        resendEndpoint="/api/auth/signup/resend"
        submitLabel="Verify email"
        pendingLabel="Verifying…"
        cancelLabel="Change email"
        onCancel={() => {
          setChallenge(null);
          setState({ pending: false });
        }}
        onSuccess={() => {
          router.replace("/workspace");
          router.refresh();
        }}
      />
    );
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
      {state.error ? (
        <p className="muted" role="alert">
          {state.error}
        </p>
      ) : null}
      <button className="button" type="submit" disabled={state.pending}>
        {state.pending ? "Sending code…" : "Create account"}
      </button>
    </form>
  );
}

type PasswordResetStep = "EMAIL" | "OTP" | "NEW_PASSWORD" | "SUCCESS";

export function ForgotPasswordForm() {
  const [step, setStep] = useState<PasswordResetStep>("EMAIL");
  const [state, setState] = useState<ActionState>({ pending: false });
  const [challenge, setChallenge] = useState<OtpChallengeMetadata | null>(null);
  const [resetGrant, setResetGrant] = useState<string | null>(null);
  useErrorToastEffect(state.error, "Password reset failed");

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setState({ pending: true });

    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.get("email") })
      });
      const payload = (await response.json().catch(() => null)) as
        | (Partial<OtpChallengeMetadata> & { error?: string; requiresVerification?: boolean })
        | null;
      if (!response.ok) {
        setState({ pending: false, error: payload?.error ?? "Could not start password recovery." });
        return;
      }
      if (
        !payload?.requiresVerification ||
        typeof payload.challengeId !== "string" ||
        typeof payload.maskedEmail !== "string" ||
        typeof payload.expiresInSeconds !== "number" ||
        typeof payload.resendAvailableInSeconds !== "number"
      ) {
        setState({ pending: false, error: "Could not start password recovery." });
        return;
      }

      setChallenge({
        challengeId: payload.challengeId,
        maskedEmail: payload.maskedEmail,
        expiresInSeconds: payload.expiresInSeconds,
        resendAvailableInSeconds: payload.resendAvailableInSeconds
      });
      setResetGrant(null);
      setStep("OTP");
      setState({ pending: false });
    } catch {
      setState({ pending: false, error: "Could not start password recovery." });
    }
  }

  async function completeReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetGrant) {
      setChallenge(null);
      setStep("EMAIL");
      setState({ pending: false, error: "This password reset has expired. Start again." });
      return;
    }

    const formData = new FormData(event.currentTarget);
    setState({ pending: true });
    try {
      const response = await fetch("/api/auth/password-reset/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resetGrant,
          newPassword: formData.get("newPassword"),
          confirmPassword: formData.get("confirmPassword")
        })
      });
      if (!response.ok) {
        const error = await readError(response, "We couldn't reset your password.");
        if (response.status === 410) {
          setResetGrant(null);
          setChallenge(null);
          setStep("EMAIL");
        }
        setState({ pending: false, error });
        return;
      }

      setResetGrant(null);
      setChallenge(null);
      setStep("SUCCESS");
      setState({ pending: false });
    } catch {
      setState({ pending: false, error: "We couldn't reset your password." });
    }
  }

  if (step === "OTP" && challenge) {
    return (
      <OtpVerificationForm
        challenge={challenge}
        verifyEndpoint="/api/auth/password-reset/verify"
        resendEndpoint="/api/auth/password-reset/resend"
        submitLabel="Verify code"
        pendingLabel="Verifying…"
        cancelLabel="Change email"
        onCancel={() => {
          setChallenge(null);
          setResetGrant(null);
          setStep("EMAIL");
          setState({ pending: false });
        }}
        onSuccess={(payload) => {
          if (!payload.resetGrant) {
            setChallenge(null);
            setStep("EMAIL");
            setState({ pending: false, error: "Could not continue password recovery. Start again." });
            return;
          }
          setResetGrant(payload.resetGrant);
          setStep("NEW_PASSWORD");
          setState({ pending: false });
        }}
      />
    );
  }

  if (step === "NEW_PASSWORD" && resetGrant) {
    return (
      <form className="form" onSubmit={completeReset} noValidate>
        <PasswordField
          id="reset-new-password"
          name="newPassword"
          label="New password"
          autoComplete="new-password"
          minLength={8}
        />
        <PasswordField
          id="reset-confirm-password"
          name="confirmPassword"
          label="Confirm new password"
          autoComplete="new-password"
          minLength={8}
        />
        {state.error ? (
          <p className="muted" role="alert">
            {state.error}
          </p>
        ) : null}
        <button className="button" type="submit" disabled={state.pending}>
          {state.pending ? "Resetting password…" : "Reset password"}
        </button>
      </form>
    );
  }

  if (step === "SUCCESS") {
    return (
      <div className="form" role="status">
        <h3>Password reset</h3>
        <p className="auth-reset-success-copy">
          Your password has been updated. You can now sign in with your new password.
        </p>
        <Link className="button" href="/login">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={requestCode} noValidate>
      <div className="field">
        <label htmlFor="password-reset-email">Email</label>
        <input id="password-reset-email" name="email" type="email" autoComplete="email" required />
      </div>
      {state.error ? (
        <p className="muted" role="alert">
          {state.error}
        </p>
      ) : null}
      <button className="button" type="submit" disabled={state.pending}>
        {state.pending ? "Sending code…" : "Send verification code"}
      </button>
    </form>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 10 ? 0 : 1)} KB`;
  }

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
}

export function UploadImportForm({
  onUploaded,
  onCancel
}: {
  onUploaded?: (importId: string) => void;
  onCancel?: () => void;
} = {}) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  useErrorToastEffect(state.error, "Import upload failed");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setState({ pending: false, error: "Choose a CSV or spreadsheet to upload." });
      return;
    }

    const form = event.currentTarget;
    setState({ pending: true });
    const formData = new FormData(form);
    formData.set("file", selectedFile);
    const response = await fetch("/api/imports", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const payload = await response.json();
      setState({ pending: false, error: payload.error ?? "Upload failed." });
      return;
    }

    const payload = (await response.json().catch(() => ({}))) as { id?: string };
    form.reset();
    setSelectedFile(null);
    setState({ pending: false });
    if (payload.id) {
      onUploaded?.(payload.id);
    }
    router.refresh();
  }

  function chooseDroppedFile(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files.item(0);
    if (file) {
      setSelectedFile(file);
      setState({ pending: false });
    }
  }

  return (
    <form className={importStyles.uploadForm} onSubmit={onSubmit}>
      <div className={importStyles.uploadField}>
        <span className={importStyles.fieldLabel}>Spreadsheet</span>
        <label
          className={`${importStyles.dropzone}${dragActive ? ` ${importStyles.dropzoneActive}` : ""}${selectedFile ? ` ${importStyles.dropzoneSelected}` : ""}`}
          htmlFor="import-file"
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={chooseDroppedFile}
        >
          <input
            className={importStyles.fileInput}
            id="import-file"
            name="file"
            type="file"
            accept=".csv,.xls,.xlsx"
            disabled={state.pending}
            onChange={(event) => {
              setSelectedFile(event.target.files?.item(0) ?? null);
              setState({ pending: false });
            }}
          />
          <span className={importStyles.dropzoneIcon} aria-hidden="true">
            {selectedFile ? <FileSpreadsheet /> : <UploadCloud />}
          </span>
          <span className={importStyles.dropzoneCopy}>
            <strong>{selectedFile ? selectedFile.name : "Choose CSV or XLSX file"}</strong>
            <span>{selectedFile ? `${formatFileSize(selectedFile.size)} · Choose another file` : "Drag and drop or browse"}</span>
          </span>
          <span className={importStyles.fileSupport}>CSV, XLSX supported</span>
        </label>
      </div>
      <p className={importStyles.actionHint}>Your file stays private to this workspace.</p>
      <div className={importStyles.stepActions}>
        {onCancel ? (
          <button
            className={`button secondary ${importStyles.secondaryAction}`}
            type="button"
            disabled={state.pending}
            onClick={onCancel}
          >
            <ArrowLeft aria-hidden="true" />
            Back to imports
          </button>
        ) : <span />}
        <button className={`button ${importStyles.primaryAction}`} type="submit" disabled={state.pending || !selectedFile}>
          {state.pending ? (
            <>
              <span className={importStyles.spinner} aria-hidden="true" />
              Uploading…
            </>
          ) : (
            "Upload import"
          )}
        </button>
      </div>
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
  const controlled = Boolean(value && onChange);
  const fields = value ?? localFields;
  const bodyValidationError = validateTemplateBody(fields.format, fields.htmlBody);
  const overallSpamScore = spamAnalysis ? Math.max(spamAnalysis.subjectScore, spamAnalysis.bodyScore) : null;
  const previewVariables = Array.from(new Set([...extractTemplateVariables(fields.subject), ...extractTemplateVariables(fields.htmlBody)]));
  const previewPayload = buildTemplatePreviewPayload(previewVariables, fields.previewPayload ?? undefined);
  const previewSubject = renderTemplateSubjectPreview(fields.subject, previewPayload);
  const previewPlainText = templateContentToPlainText(fields.format, fields.htmlBody).trim();
  const previewWordCount = previewPlainText ? previewPlainText.split(/\s+/).length : 0;
  const previewReadingMinutes = previewWordCount ? Math.max(1, Math.ceil(previewWordCount / 200)) : 0;
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
  const formBusy = state.pending || checkingSpam || enhancingField !== null;
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

  return (
    <form className="template-wizard" onSubmit={onSubmit} data-template-step={activeStep === 0 ? "compose" : "review"}>
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
            {activeStep === 0 ? "Compose your template" : "Preview and review"}
          </h2>
          <p>
            {activeStep === 0
              ? "Write the reusable message your sequences will send."
              : "Review every detail before you create the template."}
          </p>
        </header>

        {activeStep === 0 ? (
          <div className="template-wizard__step-content">
            <section className="template-form-toolbar" aria-labelledby="template-delivery-health" data-template-tour="compose-tools">
              <div className="template-form-toolbar__content">
                <p className="template-form-toolbar__eyebrow" id="template-delivery-health">
                  Delivery health
                </p>
                <p className="template-form-toolbar__copy">
                  Run a spam pass whenever you want, then use AI to tighten the copy with that score in mind.
                </p>
              </div>
              <button
                className={`template-check-spam-button${spamAnalysis ? " is-ready" : ""}`}
                type="button"
                onClick={checkSpam}
                disabled={formBusy}
              >
                {checkingSpam ? (
                  <span className="button-spinner" aria-hidden="true" />
                ) : (
                  <span className="template-check-spam-button__signal" aria-hidden="true" />
                )}
                <span className="template-check-spam-button__label">{checkingSpam ? "Checking spam" : "Check spam"}</span>
              </button>
            </section>

            <div className="template-meta-grid" data-template-tour="compose-basics">
              <div className="field template-meta-field">
                <label htmlFor="name">Template name</label>
                <input
                  id="name"
                  name="name"
                  value={fields.name}
                  onChange={(event) => updateFields((current) => ({ ...current, name: event.target.value }))}
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
              </div>
            </div>
            <p className="template-meta-hint">{renderBrandText(getTemplateBodyHint(fields.format))}</p>

            <div className="field template-compose-field" data-template-tour="compose-personalization">
              <div className="field-label-row">
                <label htmlFor="subject">Subject</label>
                <div className="field-label-row__actions">
                  {spamAnalysis ? renderSpamScoreChip(spamAnalysis.subjectScore, spamAnalysis.subjectRisk) : null}
                  <button
                    className="field-icon-button"
                    type="button"
                    onClick={() => enhanceText("subject", fields.subject)}
                    disabled={formBusy}
                    aria-label={getEnhanceTooltip("subject")}
                    data-tooltip={getEnhanceTooltip("subject")}
                  >
                    {enhancingField === "subject" ? (
                      <span className="button-spinner" aria-hidden="true" />
                    ) : (
                      <Sparkles aria-hidden="true" />
                    )}
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

            <div className="field template-compose-field">
              <div className="field-label-row">
                <label htmlFor="htmlBody">{getTemplateBodyLabel(fields.format)}</label>
                <div className="field-label-row__actions">
                  {spamAnalysis ? renderSpamScoreChip(spamAnalysis.bodyScore, spamAnalysis.bodyRisk) : null}
                  <button
                    className="field-icon-button"
                    type="button"
                    onClick={() => enhanceText("body", fields.htmlBody)}
                    disabled={formBusy}
                    aria-label={getEnhanceTooltip("body")}
                    data-tooltip={getEnhanceTooltip("body")}
                  >
                    {enhancingField === "body" ? (
                      <span className="button-spinner" aria-hidden="true" />
                    ) : (
                      <Sparkles aria-hidden="true" />
                    )}
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

            <div className="template-wizard__actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  resetTemplateAssistState();
                  onCancel?.();
                }}
                disabled={state.pending}
              >
                <ArrowLeft aria-hidden="true" />
                Back to templates
              </button>
              <button
                className="button"
                type="button"
                onClick={() => changeStep(1)}
                disabled={!composeComplete || state.pending}
                data-template-tour="compose-next"
              >
                Next: Preview
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        {activeStep === 1 ? (
          <div className="template-wizard__step-content template-wizard-preview">
            <section className="template-review-summary" aria-labelledby="template-review-summary-heading" data-template-tour="review-summary">
              <header className="template-review-summary__header">
                <div>
                  <span className="template-review-summary__eyebrow">Template summary</span>
                  <h3 id="template-review-summary-heading">Review details</h3>
                </div>
                <span className="format-badge">{getTemplateFormatLabel(fields.format)}</span>
              </header>

              <dl className="template-review-summary__details">
                <div>
                  <dt>Template name</dt>
                  <dd>{fields.name}</dd>
                </div>
                <div>
                  <dt>Spam check</dt>
                  <dd className={overallSpamScore === null ? undefined : "is-checked"}>
                    <span className="template-review-summary__status" aria-hidden="true" />
                    {overallSpamScore === null ? "Not checked" : `${overallSpamScore}% risk`}
                  </dd>
                </div>
                <div>
                  <dt>Length</dt>
                  <dd>
                    {previewWordCount} words · ~{previewReadingMinutes} min read
                  </dd>
                </div>
                <div className="template-review-summary__subject">
                  <dt>Subject</dt>
                  <dd>{previewSubject}</dd>
                </div>
              </dl>

              <div className="template-review-summary__variables">
                <span>Variables used</span>
                <div>
                  {previewVariables.length ? (
                    previewVariables.map((variable) => <code key={variable}>{`{{${variable}}}`}</code>)
                  ) : (
                    <span className="template-review-summary__empty">None detected</span>
                  )}
                </div>
              </div>
            </section>

            <section className="template-email-review" aria-labelledby="email-preview-heading" data-template-tour="review-preview">
              <header className="template-email-review__header">
                <div className="template-email-review__title">
                  <span className="template-email-review__icon" aria-hidden="true">
                    <Mail />
                  </span>
                  <div>
                    <span>Recipient view</span>
                    <h3 id="email-preview-heading">Preview email</h3>
                  </div>
                </div>
                <span className="format-badge">{getTemplateFormatLabel(fields.format)}</span>
              </header>

              <div className="template-preview-mail template-wizard-preview__mail">
                <div className="template-preview-mail__subject">
                  <span className="template-preview-mail__label">Subject</span>
                  <h4>{previewSubject}</h4>
                </div>
                <div
                  className={`template-preview-mail__body template-preview-mail__body--${fields.format.toLowerCase().replace("_", "-")}`}
                  role="document"
                  aria-label="Email body preview"
                  dangerouslySetInnerHTML={{
                    __html: renderTemplatePreview(fields.format, fields.htmlBody, previewPayload)
                  }}
                />
              </div>

              <p className="template-email-review__note">Merge fields are shown with safe sample values for this preview.</p>
            </section>

            {state.error ? (
              <p className="error-message" role="alert">
                {state.error}
              </p>
            ) : null}

            <div className="template-wizard__actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => changeStep(0)}
                disabled={state.pending}
                data-template-tour="review-back"
              >
                <ArrowLeft aria-hidden="true" />
                Back to Compose
              </button>
              <button
                className="button"
                type="submit"
                disabled={state.pending || Boolean(bodyValidationError)}
                data-template-tour="review-save"
              >
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
          <span style={{ width: `${((activeStep + 1) / TEMPLATE_WIZARD_STEPS.length) * 100}%` }} />
        </div>
        <ul className="template-wizard__checklist">
          {progressItems.map((item) => (
            <li key={item.label} className={item.complete ? "is-complete" : undefined}>
              {item.complete ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
        <p>Write the template, review the preview, then create it. Spam checking is available but optional.</p>
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
