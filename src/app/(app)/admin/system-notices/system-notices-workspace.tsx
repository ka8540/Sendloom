"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Eye,
  LoaderCircle,
  MailCheck,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  X
} from "lucide-react";

import { CircularCloseButton } from "@/components/circular-close-button";
import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { convertScheduledLocalInputToUtc, fallbackTimeZones } from "@/lib/schedule";

import styles from "./system-notices.module.css";

type NoticeType =
  | "PLANNED_MAINTENANCE"
  | "DEGRADED_PERFORMANCE"
  | "SERVICE_DISRUPTION"
  | "RESOLVED"
  | "GENERAL";
type NoticeStatus = "DRAFT" | "SCHEDULED" | "SENDING" | "COMPLETED" | "CANCELLED" | "FAILED";
type SendMode = "SEND_NOW" | "SCHEDULE";

type Notice = {
  id: string;
  type: NoticeType;
  status: NoticeStatus;
  subject: string;
  title: string;
  message: string;
  affectedArea: string | null;
  scheduledSendAt: string | null;
  impactStartsAt: string | null;
  impactEndsAt: string | null;
  timeZone: string;
  recipientsMaterializedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; email: string };
  delivery: {
    recipientTotal: number;
    sent: number;
    permanentFailures: number;
    retryable: number;
    remaining: number;
  };
};

type ListResponse = {
  notices: Notice[];
  accountRecipientCount: number;
  summary: { scheduled: number; sending: number; completed: number; attention: number };
};

type Preview = { subject: string; html: string; text: string; typeLabel: string; impactWindow: string | null };

type ComposerState = {
  type: NoticeType;
  subject: string;
  title: string;
  message: string;
  affectedArea: string;
  scheduledLocal: string;
  impactStartsLocal: string;
  impactEndsLocal: string;
  timeZone: string;
  mode: SendMode;
};

const TYPE_OPTIONS: Array<{ value: NoticeType; label: string; subject: string }> = [
  { value: "PLANNED_MAINTENANCE", label: "Planned maintenance", subject: "Scheduled maintenance: Sendloom" },
  { value: "DEGRADED_PERFORMANCE", label: "Degraded performance", subject: "Service update: Sendloom performance" },
  { value: "SERVICE_DISRUPTION", label: "Service disruption", subject: "Service disruption affecting Sendloom" },
  { value: "RESOLVED", label: "Resolved", subject: "Resolved: Sendloom service has recovered" },
  { value: "GENERAL", label: "Service notice", subject: "Sendloom service notice" }
];

const TYPE_LABELS = Object.fromEntries(TYPE_OPTIONS.map((item) => [item.value, item.label])) as Record<NoticeType, string>;
const STATUS_LABELS: Record<NoticeStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  SENDING: "Sending",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED: "Needs attention"
};

function blankComposer(timeZone = "UTC"): ComposerState {
  return {
    type: "PLANNED_MAINTENANCE",
    subject: "Scheduled maintenance: Sendloom",
    title: "Scheduled maintenance",
    message:
      "We will be performing scheduled maintenance on Sendloom. During this window, some features may respond more slowly or become temporarily unavailable.",
    affectedArea: "",
    scheduledLocal: "",
    impactStartsLocal: "",
    impactEndsLocal: "",
    timeZone,
    mode: "SCHEDULE"
  };
}

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function toLocalInput(iso: string | null, timeZone: string) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

function fromNotice(notice: Notice): ComposerState {
  return {
    type: notice.type,
    subject: notice.subject,
    title: notice.title,
    message: notice.message,
    affectedArea: notice.affectedArea ?? "",
    scheduledLocal: toLocalInput(notice.scheduledSendAt, notice.timeZone),
    impactStartsLocal: toLocalInput(notice.impactStartsAt, notice.timeZone),
    impactEndsLocal: toLocalInput(notice.impactEndsAt, notice.timeZone),
    timeZone: notice.timeZone,
    mode: notice.scheduledSendAt ? "SCHEDULE" : "SEND_NOW"
  };
}

function instantFromLocal(value: string, timeZone: string) {
  if (!value) return null;
  const date = convertScheduledLocalInputToUtc(value, timeZone);
  if (!Number.isFinite(date.getTime())) throw new Error("Enter a valid date and time.");
  return date.toISOString();
}

function payloadFromComposer(composer: ComposerState) {
  return {
    type: composer.type,
    subject: composer.subject.trim(),
    title: composer.title.trim(),
    message: composer.message.trim(),
    affectedArea: composer.affectedArea.trim() || null,
    scheduledSendAt:
      composer.mode === "SCHEDULE" ? instantFromLocal(composer.scheduledLocal, composer.timeZone) : null,
    impactStartsAt: instantFromLocal(composer.impactStartsLocal, composer.timeZone),
    impactEndsAt: instantFromLocal(composer.impactEndsLocal, composer.timeZone),
    timeZone: composer.timeZone.trim()
  };
}

function formatInstant(iso: string | null, timeZone = "UTC") {
  if (!iso) return "Not set";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function zoneDetail(timeZone: string, date = new Date()) {
  try {
    const shortParts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(date);
    const offsetParts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(date);
    const short = shortParts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
    const offset = (offsetParts.find((part) => part.type === "timeZoneName")?.value ?? "GMT").replace("GMT", "UTC");
    return `${short} (${offset})`;
  } catch {
    return "Invalid timezone";
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(body?.error ?? "The request failed. Please try again.");
  return body as T;
}

function jsonRequest(method: "POST" | "PATCH", body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

export function SystemNoticesWorkspace() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState>(() => blankComposer());
  const [composerError, setComposerError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewSignature, setPreviewSignature] = useState<string | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [selected, setSelected] = useState<Notice | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Notice | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setPageError(null);
    try {
      const next = await fetchJson<ListResponse>("/api/admin/system-notices");
      setData(next);
      setSelected((current) => next.notices.find((notice) => notice.id === current?.id) ?? current);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not load system notices.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    setComposer((current) => (current.timeZone === "UTC" ? { ...current, timeZone: browserTimeZone() } : current));
  }, [load]);

  useEffect(() => {
    if (!data?.notices.some((notice) => notice.status === "SENDING")) return;
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, [data?.notices, load]);

  const timeZones = useMemo(() => {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
    const all = supportedValuesOf ? supportedValuesOf("timeZone") : [...fallbackTimeZones];
    return Array.from(new Set([browserTimeZone(), composer.timeZone, "UTC", ...all])).sort();
  }, [composer.timeZone]);

  const currentSignature = JSON.stringify(composer);
  const hasCurrentPreview = Boolean(preview && previewSignature === currentSignature);
  const activeNotices = data?.notices.filter((notice) => notice.status === "SCHEDULED" || notice.status === "SENDING") ?? [];
  const history = data?.notices.filter((notice) => notice.status !== "SCHEDULED" && notice.status !== "SENDING") ?? [];

  function updateComposer<Key extends keyof ComposerState>(key: Key, value: ComposerState[Key]) {
    setComposer((current) => ({ ...current, [key]: value }));
    setComposerError(null);
  }

  function openNew() {
    setEditingId(null);
    setComposer(blankComposer(browserTimeZone()));
    setPreview(null);
    setPreviewSignature(null);
    setComposerError(null);
    setConfirmationText("");
    setComposerOpen(true);
  }

  function openEdit(notice: Notice) {
    setSelected(null);
    setEditingId(notice.id);
    setComposer(fromNotice(notice));
    setPreview(null);
    setPreviewSignature(null);
    setComposerError(null);
    setConfirmationText("");
    setComposerOpen(true);
  }

  async function runPreview() {
    setWorking(true);
    setComposerError(null);
    try {
      const result = await fetchJson<Preview>(
        "/api/admin/system-notices/preview",
        jsonRequest("POST", payloadFromComposer(composer))
      );
      setPreview(result);
      setPreviewSignature(currentSignature);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Could not render preview.");
    } finally {
      setWorking(false);
    }
  }

  async function persistNotice() {
    const payload = payloadFromComposer(composer);
    return editingId
      ? fetchJson<Notice>(`/api/admin/system-notices/${editingId}`, jsonRequest("PATCH", payload))
      : fetchJson<Notice>("/api/admin/system-notices", jsonRequest("POST", payload));
  }

  async function saveDraft() {
    setWorking(true);
    setComposerError(null);
    try {
      await persistNotice();
      setComposerOpen(false);
      await load(true);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Could not save the notice.");
    } finally {
      setWorking(false);
    }
  }

  function beginConfirmation() {
    if (!hasCurrentPreview) {
      setComposerError("Preview the current email before continuing.");
      return;
    }
    try {
      const payload = payloadFromComposer(composer);
      if (composer.mode === "SCHEDULE") {
        if (!payload.scheduledSendAt || new Date(payload.scheduledSendAt) <= new Date()) {
          throw new Error("Choose a future scheduled send time.");
        }
      }
      setConfirmationText("");
      setConfirmationOpen(true);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Check the notice dates.");
    }
  }

  async function confirmDelivery() {
    setWorking(true);
    setComposerError(null);
    try {
      const notice = await persistNotice();
      setEditingId(notice.id);
      if (composer.mode === "SEND_NOW") {
        await fetchJson(`/api/admin/system-notices/${notice.id}/send-now`, jsonRequest("POST"));
      } else {
        const scheduledSendAt = instantFromLocal(composer.scheduledLocal, composer.timeZone);
        await fetchJson(
          `/api/admin/system-notices/${notice.id}/schedule`,
          jsonRequest("POST", { scheduledSendAt, timeZone: composer.timeZone })
        );
      }
      setConfirmationOpen(false);
      setComposerOpen(false);
      await load(true);
    } catch (error) {
      setConfirmationOpen(false);
      setComposerError(error instanceof Error ? error.message : "Could not request delivery.");
    } finally {
      setWorking(false);
    }
  }

  async function cancelNotice() {
    if (!cancelTarget) return;
    setWorking(true);
    setCancelError(null);
    try {
      await fetchJson(`/api/admin/system-notices/${cancelTarget.id}/cancel`, jsonRequest("POST"));
      setCancelTarget(null);
      setSelected(null);
      await load(true);
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : "Could not cancel the notice.");
    } finally {
      setWorking(false);
    }
  }

  const selectedScheduledIso = (() => {
    try {
      return composer.mode === "SCHEDULE" ? instantFromLocal(composer.scheduledLocal, composer.timeZone) : null;
    } catch {
      return null;
    }
  })();
  const selectedImpactStart = (() => {
    try {
      return instantFromLocal(composer.impactStartsLocal, composer.timeZone);
    } catch {
      return null;
    }
  })();
  const selectedImpactEnd = (() => {
    try {
      return instantFromLocal(composer.impactEndsLocal, composer.timeZone);
    } catch {
      return null;
    }
  })();

  return (
    <>
      <section className={`${styles.hero} card`}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Operational communications</p>
          <h1>System Notices</h1>
          <p className="muted">Schedule and send operational updates to Sendloom users.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={openNew}>
          <Plus aria-hidden="true" /> New notice
        </button>
      </section>

      <section className={styles.metrics} aria-label="Notice metrics">
        {[
          { label: "Scheduled", value: data?.summary.scheduled ?? 0, icon: CalendarClock, tone: styles.metricBlue },
          { label: "Sending", value: data?.summary.sending ?? 0, icon: Send, tone: styles.metricGreen },
          { label: "Completed", value: data?.summary.completed ?? 0, icon: CheckCircle2, tone: styles.metricGreen },
          { label: "Failed / needs attention", value: data?.summary.attention ?? 0, icon: CircleAlert, tone: styles.metricRed }
        ].map(({ label, value, icon: Icon, tone }) => (
          <article key={label} className={`${styles.metricCard} card`}>
            <span className={`${styles.metricIcon} ${tone}`}><Icon aria-hidden="true" /></span>
            <div><strong>{value}</strong><span>{label}</span></div>
          </article>
        ))}
      </section>

      {pageError ? (
        <div className={styles.errorBanner}><CircleAlert aria-hidden="true" />{pageError}</div>
      ) : null}

      <section className={`${styles.sectionCard} card`}>
        <div className={styles.sectionHeader}>
          <div><p className={styles.kicker}>Queue</p><h2>Scheduled / active notices</h2></div>
          <button type="button" className={styles.refreshButton} onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw aria-hidden="true" className={refreshing ? styles.spin : undefined} /> Refresh
          </button>
        </div>
        <p className={styles.schedulerNote}><Clock3 aria-hidden="true" /> Delivery begins at or shortly after the selected time, typically within 5 minutes.</p>
        {loading ? <LoadingRows /> : activeNotices.length ? (
          <NoticeTable notices={activeNotices} onSelect={setSelected} />
        ) : (
          <EmptyState icon={CalendarClock} title="No scheduled notices" body="Scheduled and actively sending notices will appear here." />
        )}
      </section>

      <section className={`${styles.sectionCard} card`}>
        <div className={styles.sectionHeader}>
          <div><p className={styles.kicker}>Archive</p><h2>Delivery history</h2></div>
          <span className={styles.audiencePill}>{data?.accountRecipientCount ?? 0} current account users</span>
        </div>
        {loading ? <LoadingRows /> : history.length ? (
          <NoticeTable notices={history} onSelect={setSelected} />
        ) : (
          <EmptyState icon={MailCheck} title="No notice history" body="Drafts, completed deliveries, cancellations, and failures will appear here." />
        )}
      </section>

      {composerOpen ? (
        <div className={styles.overlay} role="presentation">
          <section className={styles.composer} role="dialog" aria-modal="true" aria-labelledby="composer-title">
            <header className={styles.composerHeader}>
              <div><p className={styles.kicker}>All account users</p><h2 id="composer-title">{editingId ? "Edit system notice" : "Create system notice"}</h2></div>
              <CircularCloseButton label="Close composer" onClick={() => !working && setComposerOpen(false)} disabled={working} />
            </header>

            <div className={styles.composerBody}>
              <div className={styles.formPane}>
                <section className={`${styles.formSection} ${styles.noticeDetailsSection}`} aria-labelledby="notice-details-heading">
                  <header className={styles.formSectionHeader}>
                    <h3 id="notice-details-heading">Notice details</h3>
                  </header>
                  <div className={styles.noticeFields}>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}><span>Notice type</span></span>
                      <select value={composer.type} onChange={(event) => {
                        const next = event.target.value as NoticeType;
                        const currentSuggestion = TYPE_OPTIONS.find((item) => item.value === composer.type)?.subject;
                        setComposer((current) => ({
                          ...current,
                          type: next,
                          subject: !current.subject || current.subject === currentSuggestion
                            ? TYPE_OPTIONS.find((item) => item.value === next)?.subject ?? current.subject
                            : current.subject
                        }));
                        setComposerError(null);
                      }}>{TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
                    </label>

                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}><span>Email subject</span><span className={styles.fieldMeta}>{composer.subject.length} / 160</span></span>
                      <input value={composer.subject} maxLength={160} onChange={(event) => updateComposer("subject", event.target.value)} />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}><span>Email title</span><span className={styles.fieldMeta}>{composer.title.length} / 140</span></span>
                      <input value={composer.title} maxLength={140} onChange={(event) => updateComposer("title", event.target.value)} />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}><span>Message</span><span className={styles.fieldMeta}>{composer.message.length} / 5000</span></span>
                      <textarea rows={7} value={composer.message} maxLength={5000} onChange={(event) => updateComposer("message", event.target.value)} />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}><span>Affected area</span><span className={styles.fieldMeta}>Optional</span></span>
                      <input value={composer.affectedArea} maxLength={160} placeholder="Sequences and campaign processing" onChange={(event) => updateComposer("affectedArea", event.target.value)} />
                    </label>
                  </div>
                </section>

                <section className={`${styles.formSection} ${styles.deliverySection}`} aria-labelledby="notice-delivery-heading">
                  <header className={styles.formSectionHeader}>
                    <h3 id="notice-delivery-heading">Delivery</h3>
                  </header>
                  <fieldset className={styles.modeFieldset}>
                    <legend className={styles.srOnly}>Delivery timing</legend>
                    <div className={styles.segmented}>
                      <button type="button" aria-pressed={composer.mode === "SEND_NOW"} className={composer.mode === "SEND_NOW" ? styles.segmentActive : undefined} onClick={() => updateComposer("mode", "SEND_NOW")}>Send now</button>
                      <button type="button" aria-pressed={composer.mode === "SCHEDULE"} className={composer.mode === "SCHEDULE" ? styles.segmentActive : undefined} onClick={() => updateComposer("mode", "SCHEDULE")}>Schedule</button>
                    </div>
                    {composer.mode === "SCHEDULE" ? (
                      <label className={`${styles.formField} ${styles.deliveryField}`}>
                        <span className={styles.fieldLabel}><span>Scheduled send</span></span>
                        <input type="datetime-local" value={composer.scheduledLocal} onChange={(event) => updateComposer("scheduledLocal", event.target.value)} />
                        <small>{composer.timeZone} · {zoneDetail(composer.timeZone, selectedScheduledIso ? new Date(selectedScheduledIso) : new Date())}</small>
                      </label>
                    ) : (
                      <div className={styles.sendNowInfo}><Send aria-hidden="true" /><div><strong>Send immediately</strong><span>Delivery will be queued now and begin on the next notification processor run.</span></div></div>
                    )}
                  </fieldset>
                </section>

                <section className={`${styles.formSection} ${styles.impactSection}`} aria-labelledby="notice-impact-heading">
                  <header className={styles.formSectionHeader}>
                    <div>
                      <h3 id="notice-impact-heading">Impact window</h3>
                      <p>Optional — tell users when they may experience disruption.</p>
                    </div>
                  </header>
                  <div className={styles.impactGrid}>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}><span>Impact starts</span><span className={styles.fieldMeta}>Optional</span></span>
                      <input type="datetime-local" value={composer.impactStartsLocal} onChange={(event) => updateComposer("impactStartsLocal", event.target.value)} />
                      <small>{composer.timeZone} · {zoneDetail(composer.timeZone, selectedImpactStart ? new Date(selectedImpactStart) : new Date())}</small>
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}><span>Impact ends</span><span className={styles.fieldMeta}>Optional</span></span>
                      <input type="datetime-local" value={composer.impactEndsLocal} onChange={(event) => updateComposer("impactEndsLocal", event.target.value)} />
                      <small>{composer.timeZone} · {zoneDetail(composer.timeZone, selectedImpactEnd ? new Date(selectedImpactEnd) : new Date())}</small>
                    </label>
                  </div>
                  <label className={`${styles.formField} ${styles.timezoneField}`}>
                    <span className={styles.fieldLabel}><span>Display timezone</span></span>
                    <input list="system-notice-time-zones" value={composer.timeZone} onChange={(event) => updateComposer("timeZone", event.target.value)} />
                    <datalist id="system-notice-time-zones">{timeZones.map((zone) => <option key={zone} value={zone} />)}</datalist>
                    <small>IANA timezone · {zoneDetail(composer.timeZone)}</small>
                  </label>
                </section>

                {composerError ? <div className={styles.formError}><CircleAlert aria-hidden="true" />{composerError}</div> : null}
              </div>

              <aside className={styles.previewPane}>
                <div className={styles.previewHeader}>
                  <div><p className={styles.kicker}>Production renderer</p><h3>Email preview</h3></div>
                  {hasCurrentPreview ? <span><ShieldCheck aria-hidden="true" /> Current</span> : preview ? <span className={styles.previewStale}><RefreshCw aria-hidden="true" /> Refresh needed</span> : null}
                </div>
                {preview ? (
                  <div className={styles.previewContent}>
                    <p className={styles.previewSubject}><span>Subject</span>{preview.subject}</p>
                    <iframe title="System notice email preview" sandbox="" srcDoc={preview.html} />
                  </div>
                ) : (
                  <div className={styles.previewEmpty}>
                    <Eye aria-hidden="true" />
                    <strong>Preview your notice</strong>
                    <span>Render the exact production email here before reviewing delivery. Preview never sends email.</span>
                    <button type="button" className={styles.previewButton} onClick={() => void runPreview()} disabled={working}><Eye aria-hidden="true" /> Preview exact email</button>
                  </div>
                )}
              </aside>
            </div>

            <footer className={styles.composerFooter}>
              <p className={hasCurrentPreview ? styles.previewReady : styles.previewRequired}>
                {hasCurrentPreview ? <ShieldCheck aria-hidden="true" /> : <Eye aria-hidden="true" />}
                {hasCurrentPreview ? "Preview matches the current content" : "Preview the current content before delivery"}
              </p>
              <div className={styles.composerActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => void saveDraft()} disabled={working}>{working ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : null}{editingId ? "Save changes" : "Save draft"}</button>
                <button type="button" className={styles.previewButton} onClick={() => void runPreview()} disabled={working}><Eye aria-hidden="true" /> Preview exact email</button>
                <button type="button" className={styles.primaryButton} onClick={beginConfirmation} disabled={working || !hasCurrentPreview}>{composer.mode === "SEND_NOW" ? "Review send now" : "Review schedule"}</button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {confirmationOpen ? (
        <div className={`${styles.overlay} ${styles.confirmOverlay}`} role="presentation">
          <section className={styles.confirmModal} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <header><span className={styles.confirmIcon}><Megaphone aria-hidden="true" /></span><div><p className={styles.kicker}>High-impact action</p><h2 id="confirm-title">Confirm delivery to all users</h2></div><button type="button" onClick={() => !working && setConfirmationOpen(false)} aria-label="Close confirmation"><X aria-hidden="true" /></button></header>
            <div className={styles.confirmAudience}><strong>{data?.accountRecipientCount ?? 0}</strong><span>current Sendloom account users</span></div>
            <dl className={styles.confirmDetails}>
              <div><dt>Subject</dt><dd>{composer.subject}</dd></div>
              <div><dt>Notice type</dt><dd>{TYPE_LABELS[composer.type]}</dd></div>
              <div><dt>Delivery</dt><dd>{composer.mode === "SEND_NOW" ? "Send now (queued for durable processing)" : formatInstant(selectedScheduledIso, composer.timeZone)}</dd></div>
              <div><dt>Timezone</dt><dd>{composer.timeZone} · {zoneDetail(composer.timeZone)}</dd></div>
              <div><dt>Impact window</dt><dd>{selectedImpactStart || selectedImpactEnd ? `${formatInstant(selectedImpactStart, composer.timeZone)} — ${formatInstant(selectedImpactEnd, composer.timeZone)}` : "Not specified"}</dd></div>
            </dl>
            {composer.mode === "SEND_NOW" ? <label className={styles.confirmPhrase}>Type <strong>SEND TO ALL USERS</strong> to continue<input autoFocus value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} /></label> : <p className={styles.confirmNote}><Clock3 aria-hidden="true" /> Delivery will not begin before the selected instant and typically starts within 5 minutes afterward.</p>}
            <footer><button type="button" className={styles.secondaryButton} onClick={() => setConfirmationOpen(false)} disabled={working}>Go back</button><button type="button" className={styles.dangerButton} onClick={() => void confirmDelivery()} disabled={working || (composer.mode === "SEND_NOW" && confirmationText !== "SEND TO ALL USERS")}>{working ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Send aria-hidden="true" />}{composer.mode === "SEND_NOW" ? "Send to all users" : "Schedule for all users"}</button></footer>
          </section>
        </div>
      ) : null}

      {selected ? (
        <div className={`${styles.overlay} ${styles.detailOverlay}`} role="presentation">
          <section className={styles.detailModal} role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <header className={styles.detailHeader}><div><span className={`${styles.statusBadge} ${styles[`status${selected.status}`]}`}>{STATUS_LABELS[selected.status]}</span><h2 id="detail-title">{selected.title}</h2><p>{TYPE_LABELS[selected.type]} · {selected.subject}</p></div><CircularCloseButton label="Close notice details" onClick={() => setSelected(null)} /></header>
            <div className={styles.detailBody}>
              <section><p className={styles.kicker}>Notice content</p><p className={styles.noticeMessage}>{selected.message}</p>{selected.affectedArea ? <div className={styles.detailFact}><span>Affected area</span><strong>{selected.affectedArea}</strong></div> : null}<div className={styles.detailFact}><span>Impact window</span><strong>{selected.impactStartsAt || selected.impactEndsAt ? `${formatInstant(selected.impactStartsAt, selected.timeZone)} — ${formatInstant(selected.impactEndsAt, selected.timeZone)}` : "Not specified"}</strong></div><div className={styles.detailFact}><span>Scheduled delivery</span><strong>{formatInstant(selected.scheduledSendAt, selected.timeZone)}</strong></div></section>
              <aside><p className={styles.kicker}>Delivery summary</p><div className={styles.deliveryGrid}><div><strong>{selected.delivery.recipientTotal}</strong><span>Recipients</span></div><div><strong>{selected.delivery.sent}</strong><span>Sent</span></div><div><strong>{selected.delivery.permanentFailures}</strong><span>Failed</span></div><div><strong>{selected.delivery.remaining}</strong><span>Remaining</span></div></div><dl className={styles.detailMeta}><div><dt>Created by</dt><dd>{selected.createdBy.email}</dd></div><div><dt>Created</dt><dd>{formatInstant(selected.createdAt, selected.timeZone)}</dd></div><div><dt>Completed</dt><dd>{formatInstant(selected.completedAt, selected.timeZone)}</dd></div><div><dt>Timezone</dt><dd>{selected.timeZone}</dd></div></dl></aside>
            </div>
            {(selected.status === "DRAFT" || selected.status === "SCHEDULED") && !selected.startedAt ? <footer className={styles.detailActions}><button type="button" className={styles.secondaryButton} onClick={() => openEdit(selected)}><Pencil aria-hidden="true" /> Edit</button><button type="button" className={styles.cancelButton} onClick={() => { setCancelError(null); setCancelTarget(selected); }}>Cancel notice</button></footer> : null}
          </section>
        </div>
      ) : null}

      <AppConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancel system notice?"
        description={<>“{cancelTarget?.title}” will be locked and will never be delivered. This can only be done before delivery starts.</>}
        confirmLabel="Cancel notice"
        loadingLabel="Cancelling…"
        destructive
        loading={working}
        error={cancelError}
        onConfirm={cancelNotice}
        onCancel={() => { if (!working) { setCancelTarget(null); setCancelError(null); } }}
      />
    </>
  );
}

function NoticeTable({ notices, onSelect }: { notices: Notice[]; onSelect: (notice: Notice) => void }) {
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Notice</th><th>Scheduled</th><th>Status</th><th>Delivery</th><th>Created by</th></tr></thead><tbody>{notices.map((notice) => <tr key={notice.id} tabIndex={0} onClick={() => onSelect(notice)} onKeyDown={(event) => { if (event.key === "Enter") onSelect(notice); }}><td><strong>{notice.title}</strong><span>{TYPE_LABELS[notice.type]}</span></td><td><strong>{formatInstant(notice.scheduledSendAt, notice.timeZone)}</strong><span>{notice.timeZone}</span></td><td><span className={`${styles.statusBadge} ${styles[`status${notice.status}`]}`}>{notice.status === "SENDING" ? <span className={styles.liveDot} /> : null}{STATUS_LABELS[notice.status]}</span></td><td><strong>{notice.delivery.sent} / {notice.delivery.recipientTotal || "—"} sent</strong><span>{notice.delivery.remaining} remaining · {notice.delivery.permanentFailures} failed</span></td><td><strong>{notice.createdBy.email}</strong><span>{formatInstant(notice.createdAt, notice.timeZone)}</span></td></tr>)}</tbody></table></div>;
}

function LoadingRows() {
  return <div className={styles.loadingRows} aria-label="Loading notices">{Array.from({ length: 3 }).map((_, index) => <span key={index} />)}</div>;
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof CalendarClock; title: string; body: string }) {
  return <div className={styles.empty}><span><Icon aria-hidden="true" /></span><h3>{title}</h3><p>{body}</p></div>;
}
