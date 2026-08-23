"use client";

import { useId, type ChangeEvent, type ClipboardEvent } from "react";

import styles from "./otp-code-input.module.css";

function digitsOnly(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function OtpCodeInput({
  value,
  onChange,
  disabled = false,
  describedBy,
  invalid = false,
  autoFocus = false
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  describedBy?: string;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const inputId = useId();

  function update(event: ChangeEvent<HTMLInputElement>) {
    onChange(digitsOnly(event.target.value));
  }

  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = digitsOnly(event.clipboardData.getData("text"));
    if (pasted) {
      event.preventDefault();
      onChange(pasted);
    }
  }

  return (
    <div className={styles.field} data-invalid={invalid || undefined}>
      <label className={styles.srOnly} htmlFor={inputId}>
        Six-digit verification code
      </label>
      <div className={styles.shell}>
        <input
          id={inputId}
          className={styles.input}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={value}
          onChange={update}
          onPaste={paste}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoFocus={autoFocus}
          spellCheck={false}
        />
        <div className={styles.slots} aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span
              className={styles.slot}
              data-active={!disabled && index === Math.min(value.length, 5) ? true : undefined}
              data-filled={Boolean(value[index]) || undefined}
              key={index}
            >
              {value[index] ?? ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
