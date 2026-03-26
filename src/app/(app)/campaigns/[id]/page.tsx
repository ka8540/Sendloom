import { after } from "next/server";
import {
  CalendarClock,
  Eye,
  FileStack,
  Mail,
  RefreshCcw,
  SendHorizontal,
  ShieldAlert,
  Users
} from "lucide-react";

import { ActiveRunRefresher } from "@/components/active-run-refresher";
import { AttachmentPreview } from "@/components/attachment-preview";
import { requireUser } from "@/lib/auth";
import { getAttachmentPreviewKind } from "@/lib/attachments";
import { prisma } from "@/lib/db";
import { launchCampaign, processPendingCampaignWork, validateCampaign } from "@/services/campaigns";
import styles from "./page.module.css";

export const maxDuration = 60;

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

    return `${frequencyLabel}${dayLabel} at ${timeLabel}`;
  }

  return "Sends immediately when launched";
}

async function launch(campaignId: string) {
  "use server";

  const user = await requireUser();
  const run = await launchCampaign(campaignId, user.id);
  after(async () => {
    await processPendingCampaignWork({
      runId: run.id,
      maxDurationMs: 55_000
    });
  });
}

async function validate(campaignId: string) {
  "use server";

  const user = await requireUser();
  await validateCampaign(campaignId, user.id);
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
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
  const launchButtonLabel = isActiveRun ? "Run is processing" : latestRun ? "Launch again" : "Launch sequence";
  const validationButtonLabel = campaign.lastValidatedAt ? "Refresh validation" : "Validate sequence";
  const scheduleLabel = formatScheduleLabel(campaign.scheduleType, campaign.scheduleConfig as ScheduleConfig | null);
  const latestRunLabel = latestRun ? formatDateTime(latestRun.updatedAt) : "Waiting to launch";

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
              {isActiveRun ? "Auto-refreshing every 8 seconds while this run is active." : `Last updated ${latestRunLabel}.`}
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
                <strong>{campaign.lastValidatedAt ? formatDateTime(campaign.lastValidatedAt) : "Not validated yet"}</strong>
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
              <button className="button" type="submit" disabled={isActiveRun}>
                {launchButtonLabel}
              </button>
            </form>
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
            <Eye aria-hidden="true" />
          </div>
          <span className={styles.metricLabel}>Engagement</span>
          <strong className={styles.metricValue}>{(latestRun?.openedCount ?? 0) + (latestRun?.clickedCount ?? 0)}</strong>
          <span className={styles.metricMeta}>Opens and clicks captured so far.</span>
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

          {latestRun?.recipientJobs.length ? (
            <div className={styles.jobList}>
              {latestRun.recipientJobs.map((job) => (
                <div key={job.id} className={styles.jobRow}>
                  <div className={styles.jobIdentity}>
                    <strong>{job.recipientEmail}</strong>
                    <span>{job.recipientName || "Recipient name not available"}</span>
                  </div>

                  <div className={styles.jobStatus}>
                    <span className="badge">{humanize(job.status)}</span>
                  </div>

                  <div className={styles.jobMeta}>
                    <span>{job.lastError ?? "No error reported"}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>Launch the sequence to start seeing recipient activity here.</div>
          )}
        </article>
      </section>
    </div>
  );
}
