"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Loader2, MailCheck } from "lucide-react";

import { OtpCodeInput } from "@/components/otp-code-input";
import styles from "./otp-verification-form.module.css";

export type OtpChallengeMetadata = {
  challengeId: string;
  maskedEmail: string;
  expiresInSeconds: number;
  resendAvailableInSeconds: number;
};

async function readPayload(response: Response) {
  return (await response.json().catch(() => null)) as
    | (Partial<OtpChallengeMetadata> & { error?: string; message?: string; success?: boolean })
    | null;
}

export function OtpVerificationForm({
  challenge,
  verifyEndpoint,
  resendEndpoint,
  submitLabel,
  pendingLabel = "Verifying…",
  cancelLabel,
  onSuccess,
  onCancel
}: {
  challenge: OtpChallengeMetadata;
  verifyEndpoint: string;
  resendEndpoint: string;
  submitLabel: string;
  pendingLabel?: string;
  cancelLabel: string;
  onSuccess: (payload: { message?: string }) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(challenge.resendAvailableInSeconds);
  const errorId = useId();
  const helpId = useId();

  useEffect(() => {
    setCode("");
    setError(null);
    setStatus(null);
    setResendSeconds(challenge.resendAvailableInSeconds);
  }, [challenge.challengeId, challenge.resendAvailableInSeconds]);

  useEffect(() => {
    if (resendSeconds <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setResendSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds > 0]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || code.length !== 6) {
      if (code.length !== 6) {
        setError("Enter the complete 6-digit code.");
      }
      return;
    }

    setPending(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(verifyEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, code })
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        setError(payload?.error ?? "We couldn't verify that code. Try again.");
        return;
      }
      await onSuccess({ message: payload?.message });
    } catch {
      setError("We couldn't verify that code. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    if (resending || resendSeconds > 0) {
      return;
    }

    setResending(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(resendEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId })
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        setError(payload?.error ?? "We couldn't send a new code. Try again shortly.");
        return;
      }
      setCode("");
      setResendSeconds(payload?.resendAvailableInSeconds ?? 60);
      setStatus("A new verification code is on its way.");
    } catch {
      setError("We couldn't send a new code. Try again shortly.");
    } finally {
      setResending(false);
    }
  }

  const describedBy = error ? `${helpId} ${errorId}` : helpId;

  return (
    <div className={styles.verification}>
      <div className={styles.heading}>
        <span className={styles.icon} aria-hidden="true">
          <MailCheck />
        </span>
        <div>
          <h3>Verify your email</h3>
          <p id={helpId}>
            We sent a 6-digit code to <strong>{challenge.maskedEmail}</strong>
          </p>
        </div>
      </div>

      <form className={`form ${styles.form}`} onSubmit={verify} noValidate>
        <OtpCodeInput
          value={code}
          onChange={(nextCode) => {
            setCode(nextCode);
            if (error) setError(null);
          }}
          disabled={pending}
          describedBy={describedBy}
          invalid={Boolean(error)}
          autoFocus
        />

        {error ? (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {status ? (
          <p className={styles.status} role="status">
            {status}
          </p>
        ) : null}

        <button className="button" type="submit" disabled={pending || resending || code.length !== 6}>
          {pending ? <Loader2 className={styles.spin} aria-hidden="true" /> : null}
          {pending ? pendingLabel : submitLabel}
        </button>
      </form>

      <div className={styles.secondaryActions}>
        <span className={styles.resendCopy} aria-live="off">
          Didn't receive it?{" "}
          <button type="button" onClick={resend} disabled={resending || resendSeconds > 0 || pending}>
            {resending ? "Sending…" : resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
          </button>
        </span>
        <button className={styles.cancel} type="button" onClick={onCancel} disabled={pending || resending}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
