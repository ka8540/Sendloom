import Link from "next/link";
import { after } from "next/server";
import {
  CalendarClock,
  CheckCircle2,
  Mail,
  RefreshCcw,
  SendHorizontal,
  Sparkles,
  Users
} from "lucide-react";

import { CampaignBuilder } from "@/components/campaign-builder";
import { LocalDateTime } from "@/components/local-date-time";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { processPendingCampaignWork } from "@/services/campaigns";
import styles from "./page.module.css";

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

function formatDeliveryLabel(scheduleType?: string | null, scheduleConfig?: ScheduleConfig | null) {
  if (scheduleType === "once") {
    const onceConfig = scheduleConfig && "scheduledFor" in scheduleConfig ? scheduleConfig : null;
    return {
      label: "Run once",
      detail: onceConfig?.scheduledFor ? formatDateTime(onceConfig.scheduledFor, onceConfig.timeZone) : "Waiting for schedule"
    };
  }

  if (scheduleType === "recurring") {
    const recurringConfig = scheduleConfig && "frequency" in scheduleConfig ? scheduleConfig : null;
    const frequencyLabel = recurringConfig?.frequency === "daily" ? "Daily" : "Weekly";
    const timeLabel = recurringConfig?.time ?? "09:00";
    const dayLabel =
      recurringConfig?.frequency === "weekly" ? ` · ${dayNames[recurringConfig?.dayOfWeek ?? 1]}` : "";
    const zoneLabel = recurringConfig?.timeZone ? ` · ${recurringConfig.timeZone}` : "";

    return {
      label: "Recurring",
      detail: `${frequencyLabel}${dayLabel} · ${timeLabel}${zoneLabel}`
    };
  }

  return {
    label: "Send now",
    detail: "Starts as soon as you launch it"
  };
}

export default async function CampaignsPage() {
  const user = await requireUser();
  const [imports, mappings, templates, senders, campaigns] = await Promise.all([
    prisma.import.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.mapping.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.template.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
    prisma.senderProfile.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" }
    }),
    prisma.campaign.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        import: {
          select: {
            fileName: true
          }
        },
        template: {
          select: {
            name: true
          }
        },
        senderProfile: {
          select: {
            name: true,
            fromEmail: true
          }
        },
        runs: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    })
  ]);
  const latestMappings = new Map<string, (typeof mappings)[number]>();

  for (const mapping of mappings) {
    if (!latestMappings.has(mapping.importId)) {
      latestMappings.set(mapping.importId, mapping);
    }
  }

  if (
    campaigns.some(
      (campaign) =>
        campaign.status === "RUNNING" ||
        campaign.runs.some((run) => ["QUEUED", "RUNNING"].includes(run.status))
    )
  ) {
    after(async () => {
      await processPendingCampaignWork({
        maxDurationMs: 20_000
      });
    });
  }

  const activeSequences = campaigns.filter(
    (campaign) =>
      campaign.status === "RUNNING" ||
      campaign.runs.some((run) => ["QUEUED", "RUNNING"].includes(run.status))
  ).length;
  const scheduledSequences = campaigns.filter((campaign) => campaign.scheduleType !== "immediate").length;
  const validatedSequences = campaigns.filter((campaign) => Boolean(campaign.lastValidatedAt)).length;

  return (
    <div className={styles.page}>
      <section className={styles.topGrid}>
        <article className={styles.builderCard}>
          <div className={styles.panelHeading}>
            <span className={styles.kicker}>Build</span>
            <h1>Create a sequence</h1>
            <p>Pick a contact list, template, sender, and send timing without leaving the dashboard.</p>
          </div>
          <CampaignBuilder
            imports={imports.map((entry) => ({ id: entry.id, label: entry.fileName }))}
            mappings={imports.flatMap((entry) => {
              const mapping = latestMappings.get(entry.id);
              if (!mapping) {
                return [];
              }

              return [
                {
                  id: mapping.id,
                  importId: entry.id,
                  label: `${entry.fileName} field set`
                }
              ];
            })}
            templates={templates.map((entry) => ({ id: entry.id, label: entry.name }))}
            senders={senders.map((entry) => ({ id: entry.id, label: `${entry.name} <${entry.fromEmail}>` }))}
          />
        </article>

        <article className={styles.senderCard}>
          <div className={styles.panelHeading}>
            <span className={styles.kicker}>Senders</span>
            <h2>Send from Gmail</h2>
            <p>Choose one of these connected accounts when you create a sequence.</p>
          </div>
          <div className={styles.senderList}>
            {senders.length ? (
              senders.map((sender) => (
                <div key={sender.id} className={styles.senderItem}>
                  <div className={styles.senderIcon}>
                    <Mail aria-hidden="true" />
                  </div>
                  <div>
                    <strong>{sender.name}</strong>
                    <div className="muted">{sender.fromEmail}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.emptyNote}>Connect a Gmail account to send emails.</div>
            )}
            <a className="button" href="/api/auth/google/connect">
              {senders.length ? "Connect another Gmail" : "Connect Gmail"}
            </a>
          </div>
        </article>
      </section>

      <section className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <Sparkles aria-hidden="true" />
          </div>
          <div>
            <span>Total sequences</span>
            <strong>{campaigns.length}</strong>
            <p>Everything currently configured in your workspace.</p>
          </div>
        </article>
        <article className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <RefreshCcw aria-hidden="true" />
          </div>
          <div>
            <span>Validated</span>
            <strong>{validatedSequences}</strong>
            <p>Sequences with a recent validation pass.</p>
          </div>
        </article>
        <article className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <CalendarClock aria-hidden="true" />
          </div>
          <div>
            <span>Scheduled</span>
            <strong>{scheduledSequences}</strong>
            <p>Run once or recurring sends queued on a schedule.</p>
          </div>
        </article>
        <article className={styles.summaryCard}>
          <div className={styles.summaryIcon}>
            <SendHorizontal aria-hidden="true" />
          </div>
          <div>
            <span>Active now</span>
            <strong>{activeSequences}</strong>
            <p>Runs that are currently queued or processing.</p>
          </div>
        </article>
      </section>

      <section className={styles.sequenceSection}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.kicker}>Sequence board</span>
            <h2>Sequences</h2>
            <p>Delivery posture, latest run, and setup context at a glance.</p>
          </div>
          <div className={styles.sectionMeta}>
            <Users aria-hidden="true" />
            <span>{campaigns.length} total</span>
          </div>
        </div>

        {campaigns.length ? (
          <div className={styles.sequenceList}>
            {campaigns.map((campaign) => {
              const latestRun = campaign.runs[0];
              const delivery = formatDeliveryLabel(campaign.scheduleType, campaign.scheduleConfig as ScheduleConfig | null);
              const latestRunSummary = latestRun
                ? `${latestRun.sentCount}/${latestRun.totalRecipients} delivered`
                : "No run started yet";
              const latestRunValue = latestRun?.updatedAt?.toISOString() ?? null;
              const validatedAtValue = campaign.lastValidatedAt?.toISOString() ?? null;

              return (
                <article key={campaign.id} className={styles.sequenceRow}>
                  <div className={styles.sequencePrimary}>
                    <div className={styles.sequenceHeader}>
                      <Link href={`/campaigns/${campaign.id}`} className={styles.sequenceTitle}>
                        {campaign.name}
                      </Link>
                      <span className="badge">{humanize(campaign.status)}</span>
                    </div>

                    <div className={styles.sequenceMetaRow}>
                      <span className={styles.metaPill}>
                        <Users aria-hidden="true" />
                        {campaign.import.fileName}
                      </span>
                      <span className={styles.metaPill}>
                        <Mail aria-hidden="true" />
                        {campaign.senderProfile.name}
                      </span>
                      <span className={styles.metaPill}>
                        <CheckCircle2 aria-hidden="true" />
                        {campaign.template.name}
                      </span>
                    </div>
                  </div>

                  <div className={styles.sequenceSignals}>
                    <div className={styles.signalCard}>
                      <span>Delivery</span>
                      <strong>{delivery.label}</strong>
                      <p>{delivery.detail}</p>
                    </div>

                    <div className={styles.signalCard}>
                      <span>Latest run</span>
                      <strong>{latestRun ? humanize(latestRun.status) : "Waiting to launch"}</strong>
                      <p>{latestRunValue ? <LocalDateTime value={latestRunValue} /> : "No delivery activity yet"}</p>
                    </div>

                    <div className={styles.signalCard}>
                      <span>Delivery health</span>
                      <strong>{latestRunSummary}</strong>
                      <p>
                        {validatedAtValue ? (
                          <>
                            Validated <LocalDateTime value={validatedAtValue} />
                          </>
                        ) : (
                          "Needs validation before the next send"
                        )}
                      </p>
                    </div>
                  </div>

                  <div className={styles.sequenceActions}>
                    <Link className="button secondary" href={`/campaigns/${campaign.id}`}>
                      Open
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>No sequences yet</strong>
            <p>Create your first sequence above to see delivery activity, timing, and validation status here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
