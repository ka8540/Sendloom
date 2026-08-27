"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Eye,
  LoaderCircle,
  MailCheck,
  PackageOpen,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";

import { AppConfirmDialog } from "@/components/app-confirm-dialog";
import { CircularCloseButton } from "@/components/circular-close-button";
import { convertScheduledLocalInputToUtc, fallbackTimeZones } from "@/lib/schedule";

import styles from "../system-notices/system-notices.module.css";
import productStyles from "./product-updates.module.css";

type BroadcastStatus = "DRAFT" | "SCHEDULED" | "SENDING" | "COMPLETED" | "CANCELLED" | "FAILED";
type SendMode = "SEND_NOW" | "SCHEDULE";

type Feature = {
  title: string;
  description: string;
  ctaLabel: string | null;
  ctaHref: string | null;
};

type Broadcast = {
  id: string;
  status: BroadcastStatus;
  subject: string;
  headline: string;
  intro: string;
  features: Feature[];
  scheduledSendAt: string | null;
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
  broadcasts: Broadcast[];
  accountRecipientCount: number;
  summary: { scheduled: number; sending: number; completed: number; attention: number };
};

type Preview = { subject: string; html: string; text: string };

type ComposerState = {
  subject: string;
  headline: string;
  intro: string;
  features: Array<{ title: string; description: string; ctaLabel: string; ctaHref: string }>;
  scheduledLocal: string;
  timeZone: string;
  mode: SendMode;
};

const STATUS_LABELS: Record<BroadcastStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  SENDING: "Sending",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED: "Needs attention"
};

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function blankComposer(timeZone = "UTC"): ComposerState {
  return {
    subject: "",
    headline: "",
    intro: "",
    features: [{ title: "", description: "", ctaLabel: "", ctaHref: "" }],
    scheduledLocal: "",
    timeZone,
    mode: "SEND_NOW"
  };
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

function fromBroadcast(broadcast: Broadcast): ComposerState {
  return {
    subject: broadcast.subject,
    headline: broadcast.headline,
    intro: broadcast.intro,
    features: broadcast.features.map((feature) => ({
      title: feature.title,
      description: feature.description,
      ctaLabel: feature.ctaLabel ?? "",
      ctaHref: feature.ctaHref ?? ""
    })),
    scheduledLocal: toLocalInput(broadcast.scheduledSendAt, broadcast.timeZone),
    timeZone: broadcast.timeZone,
    mode: broadcast.scheduledSendAt ? "SCHEDULE" : "SEND_NOW"
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
    subject: composer.subject.trim(),
    headline: composer.headline.trim(),
    intro: composer.intro.trim(),
    features: composer.features.map((feature) => ({
      title: feature.title.trim(),
      description: feature.description.trim(),
      ctaLabel: feature.ctaLabel.trim() || null,
      ctaHref: feature.ctaHref.trim() || null
    })),
    scheduledSendAt:
      composer.mode === "SCHEDULE" ? instantFromLocal(composer.scheduledLocal, composer.timeZone) : null,
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

export function ProductUpdatesWorkspace() {
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
  const [selected, setSelected] = useState<Broadcast | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Broadcast | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setPageError(null);
    try {
      const next = await fetchJson<ListResponse>("/api/admin/product-update-broadcasts");
      setData(next);
      setSelected((current) => next.broadcasts.find((broadcast) => broadcast.id === current?.id) ?? current);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not load product updates.");
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
    if (!data?.broadcasts.some((broadcast) => broadcast.status === "SENDING")) return;
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, [data?.broadcasts, load]);

  const timeZones = useMemo(() => {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
    const all = supportedValuesOf ? supportedValuesOf("timeZone") : [...fallbackTimeZones];
    return Array.from(new Set([browserTimeZone(), composer.timeZone, "UTC", ...all])).sort();
  }, [composer.timeZone]);

  const currentSignature = JSON.stringify(composer);
  const hasCurrentPreview = Boolean(preview && previewSignature === currentSignature);
  const active = data?.broadcasts.filter((broadcast) => broadcast.status === "SCHEDULED" || broadcast.status === "SENDING") ?? [];
  const history = data?.broadcasts.filter((broadcast) => broadcast.status !== "SCHEDULED" && broadcast.status !== "SENDING") ?? [];

  function updateComposer<Key extends keyof ComposerState>(key: Key, value: ComposerState[Key]) {
    setComposer((current) => ({ ...current, [key]: value }));
    setComposerError(null);
  }

  function updateFeature(index: number, key: keyof ComposerState["features"][number], value: string) {
    setComposer((current) => ({
      ...current,
      features: current.features.map((feature, featureIndex) =>
        featureIndex === index ? { ...feature, [key]: value } : feature
      )
    }));
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

  function openEdit(broadcast: Broadcast) {
    setSelected(null);
    setEditingId(broadcast.id);
    setComposer(fromBroadcast(broadcast));
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
        "/api/admin/product-update-broadcasts/preview",
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

  async function persistBroadcast() {
    const payload = payloadFromComposer(composer);
    return editingId
      ? fetchJson<Broadcast>(`/api/admin/product-update-broadcasts/${editingId}`, jsonRequest("PATCH", payload))
      : fetchJson<Broadcast>("/api/admin/product-update-broadcasts", jsonRequest("POST", payload));
  }

  async function saveDraft() {
    setWorking(true);
    setComposerError(null);
    try {
      await persistBroadcast();
      setComposerOpen(false);
      await load(true);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Could not save the product update.");
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
      if (composer.mode === "SCHEDULE" && (!payload.scheduledSendAt || new Date(payload.scheduledSendAt) <= new Date())) {
        throw new Error("Choose a future scheduled send time.");
      }
      setConfirmationText("");
      setConfirmationOpen(true);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Check the delivery schedule.");
    }
  }

  async function confirmDelivery() {
    setWorking(true);
    setComposerError(null);
    try {
      const broadcast = await persistBroadcast();
      setEditingId(broadcast.id);
      if (composer.mode === "SEND_NOW") {
        await fetchJson(
          `/api/admin/product-update-broadcasts/${broadcast.id}/send-now`,
          jsonRequest("POST", { confirmation: confirmationText })
        );
      } else {
        await fetchJson(
          `/api/admin/product-update-broadcasts/${broadcast.id}/schedule`,
          jsonRequest("POST", {
            scheduledSendAt: instantFromLocal(composer.scheduledLocal, composer.timeZone),
            timeZone: composer.timeZone
          })
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

  async function cancelBroadcast() {
    if (!cancelTarget) return;
    setWorking(true);
    setCancelError(null);
    try {
      await fetchJson(`/api/admin/product-update-broadcasts/${cancelTarget.id}/cancel`, jsonRequest("POST"));
      setCancelTarget(null);
      setSelected(null);
      await load(true);
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : "Could not cancel the product update.");
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

  return (
    <>
      <section className={`${styles.hero} card`}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Product communications</p>
          <h1>Product Updates</h1>
          <p className="muted">Announce new Sendloom features and improvements by email.</p>
        </div>
        <button type="button" className={styles.secondaryButton} onClick={openNew}>
          <Plus aria-hidden="true" /> New update
        </button>
      </section>

      <section className={styles.metrics} aria-label="Product update metrics">
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

      {pageError ? <div className={styles.errorBanner}><CircleAlert aria-hidden="true" />{pageError}</div> : null}

      <section className={`${styles.sectionCard} card`}>
        <div className={styles.sectionHeader}>
          <div><p className={styles.kicker}>Queue</p><h2>Scheduled / active updates</h2></div>
          <button type="button" className={styles.refreshButton} onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw aria-hidden="true" className={refreshing ? styles.spin : undefined} /> Refresh
          </button>
        </div>
        <p className={styles.schedulerNote}><Clock3 aria-hidden="true" /> Delivery begins at or shortly after the selected time, typically within 5 minutes.</p>
        {loading ? <LoadingRows /> : active.length ? (
          <BroadcastTable broadcasts={active} onSelect={setSelected} onEdit={openEdit} />
        ) : (
          <EmptyState icon={CalendarClock} title="No scheduled updates" body="Scheduled and actively sending announcements will appear here." />
        )}
      </section>

      <section className={`${styles.sectionCard} card`}>
        <div className={styles.sectionHeader}>
          <div><p className={styles.kicker}>History</p><h2>Product update broadcasts</h2></div>
          <span className={styles.audiencePill}>{data?.accountRecipientCount ?? 0} current account users</span>
        </div>
        {loading ? <LoadingRows /> : history.length ? (
          <BroadcastTable broadcasts={history} onSelect={setSelected} onEdit={openEdit} />
        ) : (
          <EmptyState icon={MailCheck} title="No product updates yet" body="Drafts, completed deliveries, cancellations, and failures will appear here." />
        )}
      </section>

      {composerOpen ? (
        <div className={styles.overlay} role="presentation">
          <section className={styles.composer} role="dialog" aria-modal="true" aria-labelledby="product-update-composer-title">
            <header className={styles.composerHeader}>
              <div><p className={styles.kicker}>All account users</p><h2 id="product-update-composer-title">{editingId ? "Edit product update" : "Create product update"}</h2></div>
              <CircularCloseButton label="Close composer" onClick={() => !working && setComposerOpen(false)} disabled={working} />
            </header>

            <div className={styles.composerBody}>
              <div className={styles.formPane}>
                <section className={`${styles.formSection} ${styles.noticeDetailsSection}`}>
                  <header className={styles.formSectionHeader}><h3>Email content</h3></header>
                  <div className={styles.noticeFields}>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}><span>Email subject</span><span className={styles.fieldMeta}>{composer.subject.length} / 160</span></span>
                      <input value={composer.subject} maxLength={160} placeholder="New in Sendloom: …" onChange={(event) => updateComposer("subject", event.target.value)} />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}><span>Email headline</span><span className={styles.fieldMeta}>{composer.headline.length} / 140</span></span>
                      <input value={composer.headline} maxLength={140} placeholder="A better way to …" onChange={(event) => updateComposer("headline", event.target.value)} />
                    </label>
                    <label className={styles.formField}>
                      <span className={styles.fieldLabel}><span>Intro message</span><span className={styles.fieldMeta}>{composer.intro.length} / 1500</span></span>
                      <textarea rows={5} value={composer.intro} maxLength={1500} onChange={(event) => updateComposer("intro", event.target.value)} />
                    </label>
                  </div>
                </section>

                <section className={`${styles.formSection} ${productStyles.featuresSection}`}>
                  <header className={styles.formSectionHeader}>
                    <div><h3>Released features</h3><p>Group 1–5 meaningful improvements into one announcement.</p></div>
                    <span className={productStyles.featureCount}>{composer.features.length} / 5</span>
                  </header>
                  <div className={productStyles.featureList}>
                    {composer.features.map((feature, index) => (
                      <article key={index} className={productStyles.featureCard}>
                        <header className={productStyles.featureHeader}>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <strong>Feature {index + 1}</strong>
                          {composer.features.length > 1 ? (
                            <button type="button" aria-label={`Remove feature ${index + 1}`} onClick={() => updateComposer("features", composer.features.filter((_, itemIndex) => itemIndex !== index))}>
                              <Trash2 aria-hidden="true" />
                            </button>
                          ) : null}
                        </header>
                        <label className={styles.formField}>
                          <span className={styles.fieldLabel}><span>Feature title</span><span className={styles.fieldMeta}>{feature.title.length} / 120</span></span>
                          <input value={feature.title} maxLength={120} onChange={(event) => updateFeature(index, "title", event.target.value)} />
                        </label>
                        <label className={styles.formField}>
                          <span className={styles.fieldLabel}><span>Description</span><span className={styles.fieldMeta}>{feature.description.length} / 1200</span></span>
                          <textarea rows={5} value={feature.description} maxLength={1200} onChange={(event) => updateFeature(index, "description", event.target.value)} />
                        </label>
                        <div className={productStyles.ctaGrid}>
                          <label className={styles.formField}>
                            <span className={styles.fieldLabel}><span>CTA label</span><span className={styles.fieldMeta}>Optional</span></span>
                            <input value={feature.ctaLabel} maxLength={50} placeholder="Open Sendloom" onChange={(event) => updateFeature(index, "ctaLabel", event.target.value)} />
                          </label>
                          <label className={styles.formField}>
                            <span className={styles.fieldLabel}><span>CTA destination</span><span className={styles.fieldMeta}>Internal only</span></span>
                            <input value={feature.ctaHref} maxLength={500} placeholder="/workspace" onChange={(event) => updateFeature(index, "ctaHref", event.target.value)} />
                          </label>
                        </div>
                      </article>
                    ))}
                  </div>
                  {composer.features.length < 5 ? (
                    <button type="button" className={productStyles.addFeature} onClick={() => updateComposer("features", [...composer.features, { title: "", description: "", ctaLabel: "", ctaHref: "" }])}>
                      <Plus aria-hidden="true" /> Add feature
                    </button>
                  ) : null}
                </section>

                <section className={`${styles.formSection} ${styles.deliverySection}`}>
                  <header className={styles.formSectionHeader}><h3>Delivery</h3></header>
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
                      <div className={styles.sendNowInfo}><Send aria-hidden="true" /><div><strong>Queue immediately</strong><span>A durable processor snapshots account users and delivers individual emails.</span></div></div>
                    )}
                  </fieldset>
                  <label className={`${styles.formField} ${styles.timezoneField}`}>
                    <span className={styles.fieldLabel}><span>Display timezone</span></span>
                    <input list="product-update-time-zones" value={composer.timeZone} onChange={(event) => updateComposer("timeZone", event.target.value)} />
                    <datalist id="product-update-time-zones">{timeZones.map((zone) => <option key={zone} value={zone} />)}</datalist>
                    <small>IANA timezone · {zoneDetail(composer.timeZone)}</small>
                  </label>
                </section>

                {composerError ? <div className={styles.formError}><CircleAlert aria-hidden="true" />{composerError}</div> : null}
              </div>

              <aside className={styles.previewPane}>
                <div className={styles.previewHeader}>
                  <div><p className={styles.kicker}>Production renderer</p><h3>Exact email preview</h3></div>
                  {hasCurrentPreview ? <span><ShieldCheck aria-hidden="true" /> Current</span> : preview ? <span className={styles.previewStale}><RefreshCw aria-hidden="true" /> Refresh needed</span> : null}
                </div>
                {preview ? (
                  <div className={styles.previewContent}>
                    <p className={styles.previewSubject}><span>Subject</span>{preview.subject}</p>
                    <iframe title="Product update email preview" sandbox="" srcDoc={preview.html} />
                  </div>
                ) : (
                  <div className={styles.previewEmpty}>
                    <Eye aria-hidden="true" />
                    <strong>Preview your announcement</strong>
                    <span>This uses the exact production renderer. Preview never creates recipients or sends email.</span>
                    <button type="button" className={styles.previewButton} onClick={() => void runPreview()} disabled={working}><Eye aria-hidden="true" /> Preview exact email</button>
                  </div>
                )}
              </aside>
            </div>

            <footer className={styles.composerFooter}>
              <p className={hasCurrentPreview ? styles.previewReady : styles.previewRequired}>
                {hasCurrentPreview ? <ShieldCheck aria-hidden="true" /> : <Eye aria-hidden="true" />}
                {hasCurrentPreview ? "Preview matches the current content" : "Preview current content before delivery"}
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
          <section className={styles.confirmModal} role="alertdialog" aria-modal="true" aria-labelledby="product-update-confirm-title">
            <header><span className={styles.confirmIcon}><PackageOpen aria-hidden="true" /></span><div><p className={styles.kicker}>All account users</p><h2 id="product-update-confirm-title">Confirm product update delivery</h2></div><button type="button" onClick={() => !working && setConfirmationOpen(false)} aria-label="Close confirmation"><X aria-hidden="true" /></button></header>
            <div className={styles.confirmAudience}><strong>{data?.accountRecipientCount ?? 0}</strong><span>current Sendloom account users</span></div>
            <dl className={styles.confirmDetails}>
              <div><dt>Subject</dt><dd>{composer.subject}</dd></div>
              <div><dt>Headline</dt><dd>{composer.headline}</dd></div>
              <div><dt>Features</dt><dd>{composer.features.length}</dd></div>
              <div><dt>Delivery</dt><dd>{composer.mode === "SEND_NOW" ? "Send now (durably queued)" : formatInstant(selectedScheduledIso, composer.timeZone)}</dd></div>
              <div><dt>Timezone</dt><dd>{composer.timeZone} · {zoneDetail(composer.timeZone)}</dd></div>
            </dl>
            {composer.mode === "SEND_NOW" ? (
              <label className={styles.confirmPhrase}>Type <strong>SEND TO ALL USERS</strong> to continue<input autoFocus value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} /></label>
            ) : (
              <p className={styles.confirmNote}><Clock3 aria-hidden="true" /> Audience: all persisted Sendloom account users. Delivery will never begin before the selected instant.</p>
            )}
            <footer><button type="button" className={styles.secondaryButton} onClick={() => setConfirmationOpen(false)} disabled={working}>Go back</button><button type="button" className={styles.dangerButton} onClick={() => void confirmDelivery()} disabled={working || (composer.mode === "SEND_NOW" && confirmationText !== "SEND TO ALL USERS")}>{working ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Send aria-hidden="true" />}{composer.mode === "SEND_NOW" ? "Send to all users" : "Schedule for all users"}</button></footer>
          </section>
        </div>
      ) : null}

      {selected ? (
        <div className={`${styles.overlay} ${styles.detailOverlay}`} role="presentation">
          <section className={styles.detailModal} role="dialog" aria-modal="true" aria-labelledby="product-update-detail-title">
            <header className={styles.detailHeader}><div><span className={`${styles.statusBadge} ${styles[`status${selected.status}`]}`}>{STATUS_LABELS[selected.status]}</span><h2 id="product-update-detail-title">{selected.headline}</h2><p>{selected.subject}</p></div><CircularCloseButton label="Close product update details" onClick={() => setSelected(null)} /></header>
            <div className={styles.detailBody}>
              <section><p className={styles.kicker}>Announcement content</p><p className={styles.noticeMessage}>{selected.intro}</p><div className={productStyles.detailFeatures}>{selected.features.map((feature, index) => <div key={index}><span>{String(index + 1).padStart(2, "0")}</span><strong>{feature.title}</strong><p>{feature.description}</p>{feature.ctaHref ? <small>{feature.ctaLabel} · {feature.ctaHref}</small> : null}</div>)}</div></section>
              <aside><p className={styles.kicker}>Delivery summary</p><div className={styles.deliveryGrid}><div><strong>{selected.delivery.recipientTotal}</strong><span>Recipients</span></div><div><strong>{selected.delivery.sent}</strong><span>Sent</span></div><div><strong>{selected.delivery.permanentFailures}</strong><span>Failed</span></div><div><strong>{selected.delivery.remaining}</strong><span>Remaining</span></div></div><dl className={styles.detailMeta}><div><dt>Created by</dt><dd>{selected.createdBy.email}</dd></div><div><dt>Created</dt><dd>{formatInstant(selected.createdAt, selected.timeZone)}</dd></div><div><dt>Scheduled</dt><dd>{formatInstant(selected.scheduledSendAt, selected.timeZone)}</dd></div><div><dt>Completed</dt><dd>{formatInstant(selected.completedAt, selected.timeZone)}</dd></div><div><dt>Timezone</dt><dd>{selected.timeZone}</dd></div></dl></aside>
            </div>
            {(selected.status === "DRAFT" || selected.status === "SCHEDULED") && !selected.startedAt ? <footer className={styles.detailActions}><button type="button" className={styles.secondaryButton} onClick={() => openEdit(selected)}><Pencil aria-hidden="true" /> Edit</button><button type="button" className={styles.cancelButton} onClick={() => { setCancelError(null); setCancelTarget(selected); }}>Cancel update</button></footer> : null}
          </section>
        </div>
      ) : null}

      <AppConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancel product update?"
        description={<>“{cancelTarget?.headline}” will be locked and will never be delivered. This is only available before delivery starts.</>}
        confirmLabel="Cancel update"
        loadingLabel="Cancelling…"
        destructive
        loading={working}
        error={cancelError}
        onConfirm={cancelBroadcast}
        onCancel={() => { if (!working) { setCancelTarget(null); setCancelError(null); } }}
      />
    </>
  );
}

function BroadcastTable({
  broadcasts,
  onSelect,
  onEdit
}: {
  broadcasts: Broadcast[];
  onSelect: (broadcast: Broadcast) => void;
  onEdit: (broadcast: Broadcast) => void;
}) {
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Update</th><th>Scheduled</th><th>Status</th><th>Delivery</th><th>Created by</th><th>Actions</th></tr></thead><tbody>{broadcasts.map((broadcast) => <tr key={broadcast.id} tabIndex={0} onClick={() => onSelect(broadcast)} onKeyDown={(event) => { if (event.key === "Enter") onSelect(broadcast); }}><td><strong>{broadcast.headline}</strong><span>{broadcast.features.length} feature{broadcast.features.length === 1 ? "" : "s"} · {broadcast.subject}</span></td><td><strong>{formatInstant(broadcast.scheduledSendAt, broadcast.timeZone)}</strong><span>{broadcast.timeZone}</span></td><td><span className={`${styles.statusBadge} ${styles[`status${broadcast.status}`]}`}>{broadcast.status === "SENDING" ? <span className={styles.liveDot} /> : null}{STATUS_LABELS[broadcast.status]}</span></td><td><strong>{broadcast.delivery.sent} / {broadcast.delivery.recipientTotal || "—"} sent</strong><span>{broadcast.delivery.retryable} retrying · {broadcast.delivery.permanentFailures} failed · {broadcast.delivery.remaining} remaining</span></td><td><strong>{broadcast.createdBy.email}</strong><span>{formatInstant(broadcast.createdAt, broadcast.timeZone)}</span></td><td><button type="button" className={productStyles.rowAction} onClick={(event) => { event.stopPropagation(); if ((broadcast.status === "DRAFT" || broadcast.status === "SCHEDULED") && !broadcast.startedAt) onEdit(broadcast); else onSelect(broadcast); }}>{(broadcast.status === "DRAFT" || broadcast.status === "SCHEDULED") && !broadcast.startedAt ? "Edit" : "View"}</button></td></tr>)}</tbody></table></div>;
}

function LoadingRows() {
  return <div className={styles.loadingRows} aria-label="Loading product updates">{Array.from({ length: 3 }).map((_, index) => <span key={index} />)}</div>;
}

function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return <div className={styles.empty}><span><Icon aria-hidden="true" /></span><h3>{title}</h3><p>{body}</p></div>;
}
