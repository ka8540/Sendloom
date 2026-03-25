"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type ActionState = {
  pending: boolean;
  error?: string;
};

export function LoginForm() {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });

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
      const payload = await response.json();
      setState({ pending: false, error: payload.error });
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

export function TemplateForm() {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ pending: false });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState({ pending: true });
    const formData = new FormData(form);
    const response = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        subject: formData.get("subject"),
        htmlBody: formData.get("htmlBody")
      })
    });

    if (!response.ok) {
      const payload = await response.json();
      setState({ pending: false, error: payload.error ?? "Template save failed." });
      return;
    }

    form.reset();
    router.refresh();
    setState({ pending: false });
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="name">Template name</label>
        <input id="name" name="name" required />
      </div>
      <div className="field">
        <label htmlFor="subject">Subject</label>
        <input id="subject" name="subject" placeholder="Hi {{name}}, quick question" required />
      </div>
      <div className="field">
        <label htmlFor="htmlBody">HTML body</label>
        <textarea
          id="htmlBody"
          name="htmlBody"
          defaultValue={`<p>Hi {{name}},</p>\n<p>I noticed {{company}} and wanted to reach out.</p>`}
          required
        />
      </div>
      <button className="button" type="submit" disabled={state.pending}>
        {state.pending ? "Saving..." : "Save template"}
      </button>
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
