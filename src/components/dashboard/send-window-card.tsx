import { LocalDateTime } from "@/components/local-date-time";
import type { DailySendWindow } from "@/lib/daily-send-limit";
import styles from "./send-window-card.module.css";

export type SendWindowSender = {
  senderProfileId: string;
  senderEmail: string;
  senderName: string;
  connected: boolean;
  window: DailySendWindow;
};

type Tone = "ok" | "near" | "blocked";

function resolveTone(window: DailySendWindow): Tone {
  if (window.isBlocked) return "blocked";
  if (window.limit > 0 && window.sentLast24h >= Math.max(1, Math.floor(window.limit * 0.8))) return "near";
  return "ok";
}

function chipLabel(tone: Tone) {
  if (tone === "blocked") return "Limit reached";
  if (tone === "near") return "Approaching limit";
  return "Within safety window";
}

export function SendWindowCard({
  combined,
  senders
}: {
  combined: DailySendWindow;
  senders: SendWindowSender[];
}) {
  const tone = resolveTone(combined);
  const connectedSenders = senders.filter((sender) => sender.connected);
  const usedPercent =
    combined.limit > 0
      ? Math.min(100, Math.round((combined.sentLast24h / combined.limit) * 100))
      : 0;

  return (
    <article className={styles.card} data-tone={tone} aria-label="Gmail send safety window">
      <div className={styles.head}>
        <div className={styles.eyebrowRow}>
          <span className={styles.statusDot} aria-hidden="true" />
          <span className={styles.eyebrow}>Gmail send window</span>
          <span className={styles.statusChip} data-tone={tone}>
            {chipLabel(tone)}
          </span>
        </div>

        <h2 className={styles.title}>
          {tone === "blocked"
            ? "Daily Gmail safety limit reached"
            : tone === "near"
              ? "Sending close to the daily safety limit"
              : "Gmail send window is healthy"}
        </h2>

        <p className={styles.subtitle}>
          {tone === "blocked"
            ? "Sendloom paused sending to avoid Gmail rejections. Sequences will resume automatically when the rolling 24-hour window clears."
            : "Tracking successful sends in a rolling 24-hour window per Gmail sender so campaigns stop before Gmail's quotas kick in."}
        </p>

        <div className={styles.usageBlock}>
          <div className={styles.usageRow}>
            <span className={styles.usageValue}>{combined.sentLast24h.toLocaleString()}</span>
            <span className={styles.usageDivider}>/</span>
            <span className={styles.usageLimit}>{combined.limit.toLocaleString()} sent in the last 24 hours</span>
            <span className={styles.usageRemaining}>
              <strong>{combined.remaining.toLocaleString()}</strong> remaining
            </span>
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={combined.limit}
            aria-valuenow={combined.sentLast24h}
            aria-label={`${combined.sentLast24h.toLocaleString()} of ${combined.limit.toLocaleString()} sends used`}
          >
            <span className={styles.progressFill} style={{ width: `${usedPercent}%` }} />
          </div>
        </div>
      </div>

      <div className={styles.meta}>
        <div className={styles.metaTitleRow}>
          <span className={styles.metaTitle}>
            {tone === "blocked" ? "Sending resumes" : "Window resets"}
          </span>
        </div>

        {tone === "blocked" && combined.resetAt ? (
          <p className={styles.metaResume}>
            <strong>
              <LocalDateTime value={combined.resetAt} />
            </strong>
          </p>
        ) : combined.oldestCountedSendAt ? (
          <p className={styles.metaResume}>
            Oldest send expires{" "}
            <strong>
              <LocalDateTime value={new Date(new Date(combined.oldestCountedSendAt).getTime() + 24 * 60 * 60 * 1000).toISOString()} />
            </strong>
          </p>
        ) : (
          <p className={styles.metaResume}>No sends in the last 24 hours.</p>
        )}

        <p className={styles.metaNote}>
          {tone === "blocked"
            ? "Pending recipients stay queued — no failures are recorded for sends blocked by the safety limit."
            : "Sendloom calculates the reset from the oldest counted send, so capacity returns gradually."}
        </p>

        {connectedSenders.length > 0 ? (
          <div className={styles.senderList} aria-label="Per-sender Gmail send windows">
            {connectedSenders.map((sender) => {
              const senderTone = resolveTone(sender.window);
              return (
                <div key={sender.senderProfileId} className={styles.senderRow} data-tone={senderTone}>
                  <div className={styles.senderIdentity}>
                    <span className={styles.senderName} title={sender.senderName}>
                      {sender.senderName || sender.senderEmail}
                    </span>
                    <span className={styles.senderEmail} title={sender.senderEmail}>
                      {sender.senderEmail}
                    </span>
                  </div>
                  <div className={styles.senderUsage}>
                    <span className={styles.senderUsageText}>
                      {sender.window.sentLast24h.toLocaleString()} / {sender.window.limit.toLocaleString()}
                    </span>
                    <span className={styles.senderUsageMeta}>
                      {sender.window.isBlocked && sender.window.resetAt ? (
                        <>
                          resumes <LocalDateTime value={sender.window.resetAt} />
                        </>
                      ) : (
                        <>{sender.window.remaining.toLocaleString()} remaining</>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className={styles.emptyState}>Connect a Gmail sender to see per-sender capacity.</p>
        )}
      </div>
    </article>
  );
}
