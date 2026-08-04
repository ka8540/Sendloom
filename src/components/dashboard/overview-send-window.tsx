import type { Route } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { LocalDateTime } from "@/components/local-date-time";
import type { DailySendWindow } from "@/lib/daily-send-limit";
import styles from "./overview-command-center.module.css";

export type SendWindowSender = {
  senderProfileId: string;
  senderEmail: string;
  senderName: string;
  connected: boolean;
  window: DailySendWindow;
};

type SendTone = "ok" | "near" | "blocked" | "paused";

function resolveSendTone(window: DailySendWindow): SendTone {
  if (!window.ledgerAvailable) return "paused";
  if (window.isBlocked) return "blocked";
  if (window.limit > 0 && window.sentLast24h >= Math.max(1, Math.floor(window.limit * 0.8))) return "near";
  return "ok";
}

const SEND_STATUS_LABEL: Record<SendTone, string> = {
  ok: "Healthy",
  near: "Near limit",
  blocked: "Blocked",
  paused: "Paused"
};

// The Google mark already used by the app's sign-in screens — reused verbatim
// so the sender row carries the real brand asset, not a generic mail glyph.
function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.25h2.9c1.7-1.56 2.7-3.86 2.7-6.61Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.47-.8 5.96-2.19l-2.9-2.25c-.8.54-1.84.86-3.06.86-2.35 0-4.35-1.58-5.06-3.71H.96v2.32A8.99 8.99 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.94 10.71A5.4 5.4 0 0 1 3.66 9c0-.6.1-1.18.28-1.71V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.03l2.98-2.32Z"
        fill="#FBBC04"
      />
      <path
        d="M9 3.58c1.32 0 2.5.45 3.43 1.33l2.57-2.57C13.46.9 11.42 0 9 0A8.99 8.99 0 0 0 .96 4.97l2.98 2.32C4.65 5.16 6.65 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function SendWindowCard({ combined, senders }: { combined: DailySendWindow; senders: SendWindowSender[] }) {
  const tone = resolveSendTone(combined);
  const usedPercent =
    combined.limit > 0 ? Math.min(100, Math.round((combined.sentLast24h / combined.limit) * 100)) : 0;
  const connected = senders.filter((sender) => sender.connected);
  const primary = connected[0] ?? null;
  const extraSenders = Math.max(0, connected.length - 1);
  const oldestExpiry = combined.oldestCountedSendAt
    ? new Date(new Date(combined.oldestCountedSendAt).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : null;

  return (
    <Link href={"/workspace" as Route} className={styles.sendCard} data-overview-tour="gmail-send-window">
      <div className={styles.sendHead}>
        <h2 className={styles.sideTitle}>Gmail send window</h2>
        <span className={styles.sendStatus} data-tone={tone}>
          {SEND_STATUS_LABEL[tone]}
        </span>
      </div>

      {combined.ledgerAvailable ? (
        <>
          <p className={styles.sendValue}>
            {combined.sentLast24h.toLocaleString()}
            <span className={styles.sendValueOf}> / {combined.limit.toLocaleString()}</span>
          </p>
          <p className={styles.sendUnit}>sent · rolling 24h</p>

          <div className={styles.sendVisual} data-overview-tour="gmail-progress">
            <div
              className={styles.sendMeter}
              data-tone={tone}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={combined.limit}
              aria-valuenow={combined.sentLast24h}
              aria-label={`${combined.sentLast24h.toLocaleString()} of ${combined.limit.toLocaleString()} sends used`}
            >
              <span className={styles.sendMeterFill} style={{ width: `${usedPercent}%` }} />
            </div>
            <p className={styles.sendRemaining}>
              <strong>{combined.remaining.toLocaleString()}</strong> remaining
            </p>
            {tone === "blocked" && combined.resetAt ? (
              <p className={styles.sendReset}>
                Resumes <LocalDateTime value={combined.resetAt} variant="time" />
              </p>
            ) : oldestExpiry ? (
              <p className={styles.sendReset}>
                Resets from <LocalDateTime value={oldestExpiry} variant="time" />
              </p>
            ) : (
              <p className={styles.sendReset}>No sends in the last 24h</p>
            )}
          </div>
        </>
      ) : (
        <>
          <p className={styles.sendValue}>—</p>
          <p className={styles.sendUnit}>tracking paused</p>
          <p className={styles.sendReset}>Send tracking is paused until the database setup completes.</p>
        </>
      )}

      <div className={styles.sendSender} data-overview-tour="sender-breakdown">
        <span className={styles.sendSenderIcon} aria-hidden="true">
          <GoogleIcon />
        </span>
        <span className={styles.sendSenderName}>
          {primary ? primary.senderName || primary.senderEmail : "Connect a Gmail sender to send"}
        </span>
        {extraSenders > 0 ? (
          <span className={styles.sendSenderBadge}>
            +{extraSenders} sender{extraSenders === 1 ? "" : "s"}
          </span>
        ) : null}
        <ChevronRight className={styles.sendSenderArrow} aria-hidden="true" />
      </div>
    </Link>
  );
}
