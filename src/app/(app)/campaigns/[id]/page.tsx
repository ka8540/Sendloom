import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileStack,
  Mail,
  MessageSquareReply,
  RefreshCcw,
  SendHorizontal,
  ShieldAlert,
  Users
} from "lucide-react";

import { ActiveRunRefresher } from "@/components/active-run-refresher";
import { AttachmentPreview } from "@/components/attachment-preview";
import { CampaignDetailDeleteButton } from "@/components/campaign-detail-delete-button";
import { LocalDateTime } from "@/components/local-date-time";
import { requireOperatorUser } from "@/lib/auth";
import { getAttachmentPreviewKind } from "@/lib/attachments";
import { prisma } from "@/lib/db";
import { storeUpload } from "@/lib/storage";
import {
  launchCampaign,
  pauseCampaign,
  processPendingCampaignWork,
  updateCampaignAttachments,
  validateCampaign
} from "@/services/campaigns";
import styles from "./page.module.css";

export const maxDuration = 60;
const RECIPIENTS_PAGE_SIZE = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type CampaignTemplateSnapshot = {
  attachments?: Array<{
    fileName: string;
    contentType?: string | null;
  }>;
};

type ScheduleConfig =
  | {
      type: "immediate";
    }
  | {
      type: "once";
      scheduledFor?: string;
      timeZone?: string;
    }
  | {
      type: "recurring";
      frequency?: "daily" | "weekly";
      time?: string;
      dayOfWeek?: number;
      timeZone?: string;
    };

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function formatDateTime(value?: Date | string | null, timeZone?: string) {
  if (!value) {
    return "Not available";
  }

  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone, timeZoneName: "short" as const } : {})
  }).format(date);
}

function humanize(value?: string | null) {
  if (!value) {
    return "Not set";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatScheduleLabel(scheduleType?: string | null, scheduleConfig?: ScheduleConfig | null) {
  if (scheduleType === "once") {
    const onceConfig = scheduleConfig && "scheduledFor" in scheduleConfig ? scheduleConfig : null;
    return `Scheduled for ${formatDateTime(onceConfig?.scheduledFor, onceConfig?.timeZone)}`;
  }

  if (scheduleType === "recurring") {
    const recurringConfig = scheduleConfig && "frequency" in scheduleConfig ? scheduleConfig : null;
    const frequencyLabel = recurringConfig?.frequency === "daily" ? "Daily" : "Weekly";
    const timeLabel = recurringConfig?.time ?? "09:00";
    const dayLabel =
      recurringConfig?.frequency === "weekly" ? ` on ${dayNames[recurringConfig?.dayOfWeek ?? 1]}` : "";
    const zoneLabel = recurringConfig?.timeZone ? ` (${recurringConfig.timeZone})` : "";

    return `${frequencyLabel}${dayLabel} at ${timeLabel}${zoneLabel}`;
  }

  return "Sends immediately when launched";
}

async function launch(campaignId: string) {
  "use server";

  const user = await requireOperatorUser();
  const run = await launchCampaign(campaignId, user.id);
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
  after(async () => {
    await processPendingCampaignWork({
      runId: run.id,
      maxDurationMs: 55_000
    });
  });
}

async function validate(campaignId: string) {
  "use server";

  const user = await requireOperatorUser();
  await validateCampaign(campaignId, user.id);
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
}

async function togglePause(campaignId: string) {
  "use server";

  const user = await requireOperatorUser();
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: {
      id: campaignId,
      userId: user.id
    },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  const latestRun = campaign.runs[0] ?? null;
  const isPaused = latestRun?.status === "PAUSED" || campaign.status === "PAUSED";

  if (isPaused) {
    const run = await launchCampaign(campaignId, user.id);
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");
    after(async () => {
      await processPendingCampaignWork({
        runId: run.id,
        maxDurationMs: 55_000
      });
    });
    return;
  }

  await pauseCampaign(campaignId, user.id);
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
}

async function replaceAttachment(campaignId: string, formData: FormData) {
  "use server";

  const user = await requireOperatorUser();
  const attachment = formData.get("attachment");

  if (!(attachment instanceof File) || attachment.size <= 0) {
    return;
  }

  if (attachment.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachments must be 10 MB or smaller.");
  }

  const buffer = Buffer.from(await attachment.arrayBuffer());
  const nextAttachment = process.env.VERCEL
    ? {
        fileName: attachment.name,
        contentBase64: buffer.toString("base64"),
        contentType: attachment.type || null
      }
    : {
        fileName: attachment.name,
        storagePath: await storeUpload(attachment.name, buffer, "attachments"),
        contentType: attachment.type || null
      };

  await updateCampaignAttachments(campaignId, [nextAttachment], user.id);
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
}

async function clearAttachments(campaignId: string) {
  "use server";

  const user = await requireOperatorUser();
  await updateCampaignAttachments(campaignId, [], user.id);
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
}

function buildRecipientPageHref(
  campaignId: string,
  searchParams: Record<string, string | string[] | undefined>,
  page: number
) {
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "recipientsPage" || value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => nextParams.append(key, entry));
      continue;
    }

    nextParams.set(key, value);
  }

  if (page > 1) {
    nextParams.set("recipientsPage", String(page));
  }

  const query = nextParams.toString();
  return query ? `/campaigns/${campaignId}?${query}` : `/campaigns/${campaignId}`;
}

export default async function CampaignDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOperatorUser();
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const campaign = await prisma.campaign.findFirstOrThrow({
    where: {
      id,
      userId: user.id
    },
    include: {
      import: true,
      template: true,
      senderProfile: true,
      runs: {
        orderBy: { createdAt: "desc" },
        include: {
          recipientJobs: {
            take: 50,
            orderBy: { updatedAt: "desc" }
          }
        }
      }
    }
  });

  const latestRun = campaign.runs[0];
  const isActiveRun = latestRun ? ["QUEUED", "RUNNING"].includes(latestRun.status) : false;
  const isPausedRun = latestRun?.status === "PAUSED" || campaign.status === "PAUSED";
  const attachments = ((campaign.templateSnapshot as CampaignTemplateSnapshot).attachments ?? []).filter(
    (attachment) => attachment.fileName
  );
  const attachmentPreviewItems = attachments.map((attachment, index) => ({
    contentType: attachment.contentType ?? null,
    downloadUrl: `/api/campaigns/${campaign.id}/attachments/${index}?download=1`,
    fileName: attachment.fileName,
    previewKind: getAttachmentPreviewKind(attachment.fileName, attachment.contentType),
    previewUrl: `/api/campaigns/${campaign.id}/attachments/${index}`
  }));
  const issueCount =
    (latestRun?.failedCount ?? 0) + (latestRun?.suppressedCount ?? 0) + (latestRun?.invalidCount ?? 0);
  const trackedOpenCount = latestRun?.openedCount ?? 0;
  const replyCount = latestRun?.repliedCount ?? 0;
  const launchButtonLabel = isActiveRun
    ? "Run is processing"
    : isPausedRun
      ? "Sequence paused"
      : latestRun
        ? "Launch again"
        : "Launch sequence";
  const validationButtonLabel = campaign.lastValidatedAt ? "Refresh validation" : "Validate sequence";
  const pauseButtonLabel = isPausedRun ? "Resume sequence" : "Pause sequence";
  const scheduleLabel = formatScheduleLabel(campaign.scheduleType, campaign.scheduleConfig as ScheduleConfig | null);
  const latestRunValue = latestRun?.updatedAt?.toISOString() ?? null;
  const validatedAtValue = campaign.lastValidatedAt?.toISOString() ?? null;
  const attachmentActionLabel = attachments.length ? "Replace attachment" : "Add attachment";
  const recipientJobs = latestRun?.recipientJobs ?? [];
  const totalRecipientPages = Math.max(1, Math.ceil(recipientJobs.length / RECIPIENTS_PAGE_SIZE));
  const requestedRecipientPage = Number.parseInt(String(resolvedSearchParams.recipientsPage ?? "1"), 10);
  const recipientPage = Number.isFinite(requestedRecipientPage)
    ? Math.min(Math.max(requestedRecipientPage, 1), totalRecipientPages)
    : 1;
  const paginatedRecipientJobs = recipientJobs.slice(
    (recipientPage - 1) * RECIPIENTS_PAGE_SIZE,
    recipientPage * RECIPIENTS_PAGE_SIZE
  );

  if (isActiveRun) {
    after(async () => {
      await processPendingCampaignWork({
        campaignId: campaign.id,
        maxDurationMs: 25_000
      });
    });
  }

  return (
    <div className={styles.page}>
      <ActiveRunRefresher active={isActiveRun} />
      <section className={styles.overview}>
        <div className={styles.overviewMain}>
          <div className={styles.kicker}>Sequence overview</div>
          <h1>{campaign.name}</h1>
          <p className={styles.lede}>
            Delivery posture, setup context, and live run health for this sequence in one place.
          </p>

          <div className={styles.metaRow}>
            <span className={styles.metaChip}>
              <Users aria-hidden="true" />
              {campaign.import.fileName}
            </span>
            <span className={styles.metaChip}>
              <FileStack aria-hidden="true" />
              {campaign.template.name}
            </span>
            <span className={styles.metaChip}>
              <Mail aria-hidden="true" />
              {campaign.senderProfile.fromEmail}
            </span>
          </div>
        </div>

        <aside className={styles.overviewRail}>
          <div className={styles.statusWrap}>
            <span className="badge">{humanize(campaign.status)}</span>
            <span className={styles.statusNote}>
              {isActiveRun ? (
                "Auto-refreshing every 8 seconds while this run is active."
              ) : latestRunValue ? (
                <>
                  Last updated <LocalDateTime value={latestRunValue} />.
                </>
              ) : (
                "Waiting to launch."
              )}
            </span>
          </div>

          <div className={styles.summaryList}>
            <div className={styles.summaryItem}>
              <CalendarClock aria-hidden="true" />
              <div>
                <span>Send timing</span>
                <strong>{scheduleLabel}</strong>
              </div>
            </div>
            <div className={styles.summaryItem}>
              <RefreshCcw aria-hidden="true" />
              <div>
                <span>Validated</span>
                <strong>{validatedAtValue ? <LocalDateTime value={validatedAtValue} /> : "Not validated yet"}</strong>
              </div>
            </div>
            <div className={styles.summaryItem}>
              <SendHorizontal aria-hidden="true" />
              <div>
                <span>Current run</span>
                <strong>{latestRun ? humanize(latestRun.status) : "Not launched yet"}</strong>
              </div>
            </div>
          </div>

          <div className={styles.actionRow}>
            <form action={validate.bind(null, campaign.id)}>
              <button className="button secondary" type="submit">
                {validationButtonLabel}
              </button>
            </form>
            <form action={launch.bind(null, campaign.id)}>
              <button className="button" type="submit" disabled={isActiveRun || isPausedRun}>
                {launchButtonLabel}
              </button>
            </form>
            {latestRun && (isActiveRun || isPausedRun) ? (
              <form action={togglePause.bind(null, campaign.id)}>
                <button className="button secondary" type="submit">
                  {pauseButtonLabel}
                </button>
              </form>
            ) : null}
            <CampaignDetailDeleteButton campaignId={campaign.id} campaignName={campaign.name} />
          </div>
        </aside>
      </section>

      <section className={styles.metrics}>
        <article className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <Users aria-hidden="true" />
          </div>
          <span className={styles.metricLabel}>Audience size</span>
          <strong className={styles.metricValue}>{latestRun?.totalRecipients ?? campaign.import.rowCount ?? 0}</strong>
          <span className={styles.metricMeta}>People queued for this run.</span>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <SendHorizontal aria-hidden="true" />
          </div>
          <span className={styles.metricLabel}>Delivered</span>
          <strong className={styles.metricValue}>{latestRun?.sentCount ?? 0}</strong>
          <span className={styles.metricMeta}>Messages confirmed as sent.</span>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <MessageSquareReply aria-hidden="true" />
          </div>
          <span className={styles.metricLabel}>Replies</span>
          <strong className={styles.metricValue}>{replyCount}</strong>
          <span className={styles.metricMeta}>Recipients with at least one reply matched from the connected inbox.</span>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <ShieldAlert aria-hidden="true" />
          </div>
          <span className={styles.metricLabel}>Needs attention</span>
          <strong className={styles.metricValue}>{issueCount}</strong>
          <span className={styles.metricMeta}>Failures, suppressions, and invalid records.</span>
        </article>
      </section>
      <p className={styles.metricsNote}>
        This run has {trackedOpenCount} tracked open{trackedOpenCount === 1 ? "" : "s"} and uses opens only as a secondary
        engagement signal.
      </p>

      <section className={styles.detailGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Sequence setup</h2>
              <p>The core pieces tied to this run.</p>
            </div>
          </div>

          <div className={styles.setupGrid}>
            <div className={styles.setupItem}>
              <span>Contact list</span>
              <strong>{campaign.import.fileName}</strong>
            </div>
            <div className={styles.setupItem}>
              <span>Email template</span>
              <strong>{campaign.template.name}</strong>
            </div>
            <div className={styles.setupItem}>
              <span>Sender</span>
              <strong>{campaign.senderProfile.name || campaign.senderProfile.fromEmail}</strong>
              <em>{campaign.senderProfile.fromEmail}</em>
            </div>
            <div className={styles.setupItem}>
              <span>Send timing</span>
              <strong>{scheduleLabel}</strong>
            </div>
          </div>

          <div className={styles.assetBlock}>
            <div className={styles.assetHeader}>
              <h3>Attachments</h3>
              <span>{attachments.length ? `${attachments.length} file${attachments.length > 1 ? "s" : ""}` : "No attachments"}</span>
            </div>
            <div className={styles.attachmentTools}>
              <form action={replaceAttachment.bind(null, campaign.id)} className={styles.attachmentUploadForm}>
                <label className={styles.attachmentPicker}>
                  <span>{attachments.length ? "Choose a new resume or file" : "Choose a resume or file"}</span>
                  <input type="file" name="attachment" />
                </label>
                <button className="button secondary" type="submit">
                  {attachmentActionLabel}
                </button>
              </form>
              {attachments.length ? (
                <form action={clearAttachments.bind(null, campaign.id)}>
                  <button className="button secondary" type="submit">
                    Remove attachment
                  </button>
                </form>
              ) : null}
              <p className={styles.attachmentHint}>The next launch will use the attachment shown here.</p>
            </div>
            {attachmentPreviewItems.length ? (
              <AttachmentPreview attachments={attachmentPreviewItems} />
            ) : (
              <div className={styles.emptyState}>No attachment is included with this sequence right now.</div>
            )}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Recent recipient activity</h2>
              <p>The newest recipient updates from the latest run.</p>
            </div>
          </div>

          {recipientJobs.length ? (
            <div className={styles.jobList}>
              {paginatedRecipientJobs.map((job) => (
                <div key={job.id} className={styles.jobRow}>
                  <div className={styles.jobIdentity}>
                    <strong>{job.recipientEmail}</strong>
                    <span>{job.recipientName || "Recipient name not available"}</span>
                  </div>
                  <div className={styles.jobMeta}>
                    <span className="badge">{job.replyCount > 0 ? "Replied" : humanize(job.status)}</span>
                    <span className={styles.jobMetaText}>
                      {job.replyCount > 0
                        ? `${job.replyCount} repl${job.replyCount === 1 ? "y" : "ies"} matched in the inbox`
                        : job.lastError ?? "No error reported"}
                    </span>
                  </div>
                </div>
              ))}

              {recipientJobs.length > RECIPIENTS_PAGE_SIZE ? (
                <div className={styles.paginationRow}>
                  <a
                    href={buildRecipientPageHref(campaign.id, resolvedSearchParams, recipientPage - 1)}
                    className={styles.paginationButton}
                    aria-label="Previous recipient page"
                    aria-disabled={recipientPage === 1}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </a>
                  <span className={styles.paginationCount}>
                    {recipientPage} / {totalRecipientPages}
                  </span>
                  <a
                    href={buildRecipientPageHref(campaign.id, resolvedSearchParams, recipientPage + 1)}
                    className={styles.paginationButton}
                    aria-label="Next recipient page"
                    aria-disabled={recipientPage === totalRecipientPages}
                  >
                    <ChevronRight aria-hidden="true" />
                  </a>
                </div>
              ) : null}
            </div>
          ) : (
            <div className={styles.emptyState}>Launch the sequence to start seeing recipient activity here.</div>
          )}
        </article>
      </section>
    </div>
  );
}
