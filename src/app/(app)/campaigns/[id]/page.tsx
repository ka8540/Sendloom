import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileStack,
  Mail,
  RefreshCcw,
  SendHorizontal,
  ShieldAlert,
  Users
} from "lucide-react";

import { ActiveRunRefresher } from "@/components/active-run-refresher";
import { CampaignSetupEditor } from "@/components/campaign-setup-editor";
import { CampaignDetailDeleteButton } from "@/components/campaign-detail-delete-button";
import { ErrorToastOnMount } from "@/components/error-toast-provider";
import { LocalDateTime } from "@/components/local-date-time";
import { getAttachmentPreviewKind } from "@/lib/attachments";
import { requireOperatorUser } from "@/lib/auth";
import { isCampaignSetupLocked } from "@/lib/campaign-setup-lock";
import { prisma } from "@/lib/db";
import { GMAIL_RECONNECT_ERROR } from "@/lib/provider";
import { launchCampaign, pauseCampaign, processPendingCampaignWork, validateCampaign } from "@/services/campaigns";
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

function getDeliveredCount(run?: {
  sentCount?: number | null;
  openedCount?: number | null;
  clickedCount?: number | null;
} | null) {
  return (run?.sentCount ?? 0) + (run?.openedCount ?? 0) + (run?.clickedCount ?? 0);
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
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      userId: user.id
    },
    select: {
      senderProfile: {
        select: {
          fromEmail: true,
          oauthRefreshToken: true
        }
      }
    }
  });

  if (!campaign) {
    redirect("/campaigns");
  }

  if (!campaign.senderProfile.oauthRefreshToken) {
    const params = new URLSearchParams({
      gmail_error: GMAIL_RECONNECT_ERROR,
      gmail_sender: campaign.senderProfile.fromEmail
    });
    redirect(`/campaigns/${campaignId}?${params.toString()}`);
  }

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
      },
      senderProfile: {
        select: {
          fromEmail: true,
          oauthRefreshToken: true
        }
      }
    }
  });

  const latestRun = campaign.runs[0] ?? null;
  const isPaused = latestRun?.status === "PAUSED" || campaign.status === "PAUSED";

  if (isPaused) {
    if (!campaign.senderProfile.oauthRefreshToken) {
      const params = new URLSearchParams({
        gmail_error: GMAIL_RECONNECT_ERROR,
        gmail_sender: campaign.senderProfile.fromEmail
      });
      redirect(`/campaigns/${campaignId}?${params.toString()}`);
    }

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

function getSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
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
  const gmailStatus = getSearchParam(resolvedSearchParams, "gmail");
  const gmailError = getSearchParam(resolvedSearchParams, "gmail_error");
  const gmailSender = getSearchParam(resolvedSearchParams, "gmail_sender");
  const gmailErrorMessage = gmailError ? `${gmailError}${gmailSender ? ` Reconnect ${gmailSender} before sending again.` : ""}` : null;
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
  const [imports, mappings, templates, senders] = await Promise.all([
    prisma.import.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        fileName: true,
        rowCount: true
      }
    }),
    prisma.mapping.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        importId: true,
        variableMap: true,
        reservedFieldMap: true
      }
    }),
    prisma.template.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        format: true
      }
    }),
    prisma.senderProfile.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        fromEmail: true,
        oauthRefreshToken: true
      }
    })
  ]);

  const latestRun = campaign.runs[0];
  const senderNeedsReconnect = !campaign.senderProfile.oauthRefreshToken;
  const isActiveRun = latestRun ? ["QUEUED", "RUNNING"].includes(latestRun.status) : false;
  const isPausedRun = latestRun?.status === "PAUSED" || campaign.status === "PAUSED";
  const setupLocked = isCampaignSetupLocked({
    campaignStatus: campaign.status,
    latestRunStatus: latestRun?.status ?? null
  });
  const attachments = ((campaign.templateSnapshot as CampaignTemplateSnapshot).attachments ?? []).filter(
    (attachment) => attachment.fileName
  );
  const issueCount =
    (latestRun?.failedCount ?? 0) + (latestRun?.suppressedCount ?? 0) + (latestRun?.invalidCount ?? 0);
  const trackedClickCount = latestRun?.clickedCount ?? 0;
  const deliveredCount = getDeliveredCount(latestRun);
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
  const reconnectHref = `/api/auth/google/connect?email=${encodeURIComponent(campaign.senderProfile.fromEmail)}&next=${encodeURIComponent(`/campaigns/${campaign.id}`)}`;
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
  const latestMappingsByImport = new Map<string, (typeof mappings)[number]>();

  for (const mapping of mappings) {
    if (!latestMappingsByImport.has(mapping.importId)) {
      latestMappingsByImport.set(mapping.importId, mapping);
    }
  }

  const importOptions = imports.map((entry) => {
    const mapping = latestMappingsByImport.get(entry.id);
    const variableMap =
      mapping?.variableMap && typeof mapping.variableMap === "object" && !Array.isArray(mapping.variableMap)
        ? (mapping.variableMap as Record<string, string>)
        : {};
    const fieldCount = Object.keys(variableMap).length;

    return {
      id: entry.id,
      label: entry.fileName,
      description: mapping
        ? `${entry.rowCount} contacts • ${fieldCount} mapped field${fieldCount === 1 ? "" : "s"}`
        : `${entry.rowCount} contacts • configure template fields first`,
      disabled: !mapping
    };
  });

  const templateOptions = templates.map((template) => ({
    id: template.id,
    label: template.name,
    description: `${humanize(template.format)} template`
  }));

  const senderOptions = senders.map((sender) => ({
    id: sender.id,
    label: sender.name || sender.fromEmail,
    description: sender.oauthRefreshToken
      ? sender.fromEmail
      : `${sender.fromEmail} • reconnect required`,
    disabled: !sender.oauthRefreshToken
  }));

  const initialSetup = {
    name: campaign.name,
    importId: campaign.importId,
    templateId: campaign.templateId,
    senderProfileId: campaign.senderProfileId,
    attachments: attachments.map((attachment, index) => ({
      id: `existing-${index}`,
      sourceIndex: index,
      fileName: attachment.fileName,
      contentType: attachment.contentType ?? null,
      previewKind: getAttachmentPreviewKind(attachment.fileName, attachment.contentType ?? null),
      previewUrl: `/api/campaigns/${campaign.id}/attachments/${index}`,
      downloadUrl: `/api/campaigns/${campaign.id}/attachments/${index}?download=1`
    }))
  };

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
      {gmailErrorMessage ? <ErrorToastOnMount message={gmailErrorMessage} title="Gmail connection failed" /> : null}
      {gmailStatus === "connected" ? (
        <div className={styles.flashNotice}>
          <RefreshCcw aria-hidden="true" />
          <span>Gmail reconnected. This sequence is ready to launch again.</span>
        </div>
      ) : null}
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
          {senderNeedsReconnect ? (
            <div className={styles.reconnectNotice}>
              <strong>Sender needs reconnect</strong>
              <p>
                Google revoked access for {campaign.senderProfile.fromEmail}. Reconnect it before you launch this
                sequence again.
              </p>
              <a className="button secondary" href={reconnectHref}>
                Reconnect Gmail
              </a>
            </div>
          ) : null}
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

          <div className={styles.actionGroup}>
            <div className={styles.actionSecondaryRow}>
              <form action={validate.bind(null, campaign.id)} className={styles.actionSecondaryItem}>
                <button className="button secondary" type="submit">
                  {validationButtonLabel}
                </button>
              </form>
              {latestRun && (isActiveRun || isPausedRun) ? (
                <form action={togglePause.bind(null, campaign.id)} className={styles.actionSecondaryItem}>
                  <button className="button secondary" type="submit">
                    {pauseButtonLabel}
                  </button>
                </form>
              ) : null}
              <CampaignDetailDeleteButton campaignId={campaign.id} campaignName={campaign.name} />
            </div>

            <div className={styles.actionPrimaryRow}>
              {senderNeedsReconnect ? (
                <a className="button" href={reconnectHref}>
                  Reconnect to launch
                </a>
              ) : (
                <form action={launch.bind(null, campaign.id)}>
                  <button className="button" type="submit" disabled={isActiveRun || isPausedRun}>
                    {launchButtonLabel}
                  </button>
                </form>
              )}
            </div>
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
          <strong className={styles.metricValue}>{deliveredCount}</strong>
          <span className={styles.metricMeta}>Messages that successfully reached recipients.</span>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricIcon}>
            <Eye aria-hidden="true" />
          </div>
          <span className={styles.metricLabel}>Tracked clicks</span>
          <strong className={styles.metricValue}>{trackedClickCount}</strong>
          <span className={styles.metricMeta}>Stronger than opens, but still treated as a tracking signal.</span>
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
          <CampaignSetupEditor
            campaignId={campaign.id}
            currentSenderNeedsReconnect={senderNeedsReconnect}
            importOptions={importOptions}
            initialSetup={initialSetup}
            isLocked={setupLocked}
            senderOptions={senderOptions}
            templateOptions={templateOptions}
            scheduleLabel={scheduleLabel}
          />
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
                    <span>{job.recipientName || "Name unavailable"}</span>
                  </div>
                  <div className={styles.jobTrail}>
                    <span className={styles.jobStatusBadge}>{humanize(job.status)}</span>
                    <span className={job.lastError ? styles.jobError : styles.jobErrorMuted}>
                      {job.lastError ?? "No error reported"}
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
