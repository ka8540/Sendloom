"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type ActionState = {
  pending: boolean;
  error?: string;
};

type EnhanceField = "subject" | "body";

const DEFAULT_TEMPLATE_HTML = `<p>Hi {{name}},</p>\n<p>I noticed {{company}} and wanted to reach out.</p>`;

export type TemplateDraft = {
  name: string;
  subject: string;
  htmlBody: string;
};

export type EditableTemplate = {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  variableManifest: string[];
};

export function LoginForm() {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });

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

    router.replace("/workspace");
    router.refresh();
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required />
      </div>
      {state.error ? <p className="muted">{state.error}</p> : null}
      <button className="button" type="submit" disabled={state.pending}>
        {state.pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });

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
      <div className="field">
        <label htmlFor="signup-password">Password</label>
        <input id="signup-password" name="password" type="password" minLength={8} required />
      </div>
      <div className="field">
        <label htmlFor="signup-confirm-password">Confirm password</label>
        <input id="signup-confirm-password" name="confirmPassword" type="password" minLength={8} required />
      </div>
      {state.error ? <p className="muted">{state.error}</p> : null}
      <button className="button" type="submit" disabled={state.pending}>
        {state.pending ? "Creating account..." : "Create account"}
      </button>
    </form>
  );
}

export function UploadImportForm() {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });

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

    router.refresh();
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="file">Spreadsheet</label>
        <input id="file" name="file" type="file" accept=".csv,.xls,.xlsx" required />
      </div>
      {state.error ? <p className="muted">{state.error}</p> : null}
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
  return {
    name: template?.name ?? "",
    subject: template?.subject ?? "",
    htmlBody: template?.htmlBody ?? DEFAULT_TEMPLATE_HTML
  };
}

export function TemplateForm({ initialTemplate = null, value, onChange, onSaved, onCancel }: TemplateFormProps) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });
  const [localFields, setLocalFields] = useState(getTemplateFields(initialTemplate));
  const [enhancingField, setEnhancingField] = useState<EnhanceField | null>(null);
  const [enhanceError, setEnhanceError] = useState<Partial<Record<EnhanceField, string>>>({});
  const [highlightedField, setHighlightedField] = useState<EnhanceField | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const controlled = Boolean(value && onChange);
  const fields = value ?? localFields;

  const updateFields = (updater: (current: TemplateDraft) => TemplateDraft) => {
    if (controlled && onChange) {
      onChange(updater(fields));
      return;
    }

    setLocalFields(updater);
  };

  useEffect(() => {
    if (controlled) {
      return;
    }

    setLocalFields(getTemplateFields(initialTemplate));
    setState({ pending: false });
    setEnhanceError({});
  }, [controlled, initialTemplate?.id]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  async function enhanceText(fieldType: EnhanceField, currentText: string) {
    const trimmedText = currentText.trim();
    if (!trimmedText) {
      setEnhanceError((current) => ({
        ...current,
        [fieldType]: `Add some ${fieldType === "subject" ? "subject" : "body"} text before using AI.`
      }));
      return;
    }

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
          currentText: trimmedText
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

      updateFields((current) => ({
        ...current,
        ...(fieldType === "subject" ? { subject: payload.enhancedText! } : { htmlBody: payload.enhancedText! })
      }));
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
        htmlBody: fields.htmlBody
      })
    });

    if (!response.ok) {
      const payload = await response.json();
      setState({ pending: false, error: payload.error ?? "Template save failed." });
      return;
    }

    const savedTemplate = (await response.json()) as EditableTemplate;

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
        <div className="field-label-row">
          <label htmlFor="subject">Subject</label>
          <button
            className="field-enhance-button"
            type="button"
            onClick={() => enhanceText("subject", fields.subject)}
            disabled={state.pending || enhancingField !== null}
          >
            {enhancingField === "subject" ? (
              <>
                <span className="button-spinner" aria-hidden="true" />
                Enhancing...
              </>
            ) : (
              "✨ Enhance with AI"
            )}
          </button>
        </div>
        <input
          id="subject"
          name="subject"
          value={fields.subject}
          onChange={(event) => {
            setEnhanceError((current) => ({ ...current, subject: undefined }));
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
          <label htmlFor="htmlBody">HTML body</label>
          <button
            className="field-enhance-button"
            type="button"
            onClick={() => enhanceText("body", fields.htmlBody)}
            disabled={state.pending || enhancingField !== null}
          >
            {enhancingField === "body" ? (
              <>
                <span className="button-spinner" aria-hidden="true" />
                Enhancing...
              </>
            ) : (
              "✨ Enhance with AI"
            )}
          </button>
        </div>
        <textarea
          id="htmlBody"
          name="htmlBody"
          value={fields.htmlBody}
          onChange={(event) => {
            setEnhanceError((current) => ({ ...current, body: undefined }));
            updateFields((current) => ({ ...current, htmlBody: event.target.value }));
          }}
          className={highlightedField === "body" ? "field-enhanced" : undefined}
          required
        />
        {enhanceError.body ? <p className="field-inline-note">{enhanceError.body}</p> : null}
      </div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <button className="button" type="submit" disabled={state.pending}>
          {state.pending ? "Saving..." : isEditing ? "Save changes" : "Save template"}
        </button>
        {isEditing ? (
          <button
            className="button secondary"
            type="button"
            onClick={() => onCancel?.()}
            disabled={state.pending}
          >
            Cancel
          </button>
        ) : null}
      </div>
      {state.error ? <p className="muted">{state.error}</p> : null}
    </form>
  );
}

export function SuppressionForm() {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });

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
      {state.error ? <p className="muted">{state.error}</p> : null}
    </form>
  );
}
