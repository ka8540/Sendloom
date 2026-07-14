import { CheckCircle2, ChevronRight, Mail, Plus, RefreshCcw } from "lucide-react";

import { CampaignBuilder } from "@/components/campaign-builder";
import { ErrorToastOnMount } from "@/components/error-toast-provider";
import { BounceMonitoringStatus } from "@/components/senders/bounce-monitoring-status";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveBounceMonitoringStatus } from "@/services/bounces";
import styles from "./page.module.css";

const BUILDER_PATH = ["Audience", "Message", "Sender", "Timing"] as const;

function getSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewSequencePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOperatorUser();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const gmailStatus = getSearchParam(resolvedSearchParams, "gmail");
  const gmailError = getSearchParam(resolvedSearchParams, "gmail_error");
  const [imports, mappings, templates, senders] = await Promise.all([
    prisma.import.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.mapping.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.template.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
    prisma.senderProfile.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" }
    })
  ]);
  const latestMappings = new Map<string, (typeof mappings)[number]>();
  const connectedSenders = senders.filter((sender) => Boolean(sender.oauthRefreshToken));
  const disconnectedSenders = senders.filter((sender) => !sender.oauthRefreshToken);

  for (const mapping of mappings) {
    if (!latestMappings.has(mapping.importId)) {
      latestMappings.set(mapping.importId, mapping);
    }
  }

  return (
    <div className={styles.page}>
      {gmailError ? <ErrorToastOnMount message={gmailError} title="Gmail connection failed" /> : null}
      {gmailStatus === "connected" ? (
        <div className={styles.flashNotice}>
          <CheckCircle2 aria-hidden="true" />
          <span>Gmail reconnected. You can use that sender again.</span>
        </div>
      ) : null}

      <header className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <span className={styles.kicker}>Build</span>
          <h1>Create a sequence</h1>
          <p>Pick your audience, template, sender, and launch timing.</p>
        </div>
        <div className={styles.flowPath} aria-hidden="true">
          {BUILDER_PATH.map((stop, index) => (
            <span key={stop} className={styles.flowStop}>
              {index > 0 ? <ChevronRight className={styles.flowArrow} /> : null}
              <span className={styles.flowChip}>{stop}</span>
            </span>
          ))}
        </div>
      </header>

      <section className={styles.topGrid}>
        <article className={styles.builderCard} id="create-sequence">
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
            senders={connectedSenders.map((entry) => ({ id: entry.id, label: `${entry.name} <${entry.fromEmail}>` }))}
            disconnectedSenderCount={disconnectedSenders.length}
            reconnectHref={
              disconnectedSenders[0]
                ? `/api/auth/google/connect?email=${encodeURIComponent(disconnectedSenders[0].fromEmail)}&next=${encodeURIComponent("/campaigns/new")}`
                : undefined
            }
          />
        </article>

        <aside className={styles.senderPanel} aria-label="Send from Gmail">
          <div className={styles.senderPanelHeading}>
            <div className={styles.senderPanelTitleRow}>
              <h2>Send from Gmail</h2>
              {connectedSenders.length ? (
                <span className={styles.senderCount}>
                  {connectedSenders.length} connected
                </span>
              ) : null}
            </div>
            <p>Every email in this sequence goes out through one of these accounts.</p>
          </div>

          <div className={styles.senderList}>
            {connectedSenders.length ? (
              connectedSenders.map((sender) => (
                <div key={sender.id} className={styles.senderRow}>
                  <div className={styles.senderIcon}>
                    <Mail aria-hidden="true" />
                  </div>
                  <div className={styles.senderMeta}>
                    <div className={styles.senderNameRow}>
                      <strong>{sender.name}</strong>
                      <span className={styles.senderChip}>Connected</span>
                    </div>
                    <span className={styles.senderEmail}>{sender.fromEmail}</span>
                    <BounceMonitoringStatus
                      senderId={sender.id}
                      status={resolveBounceMonitoringStatus(sender)}
                      backfillCompleted={Boolean(sender.bounceBackfillCompletedAt)}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.senderEmpty}>
                {disconnectedSenders.length
                  ? "Reconnect Gmail to keep sending from this workspace."
                  : "Connect a Gmail account to send emails."}
              </div>
            )}

            {disconnectedSenders.map((sender) => (
              <div key={sender.id} className={`${styles.senderRow} ${styles.senderRowWarning}`}>
                <div className={styles.senderIcon}>
                  <RefreshCcw aria-hidden="true" />
                </div>
                <div className={styles.senderMeta}>
                  <div className={styles.senderNameRow}>
                    <strong>{sender.name}</strong>
                    <span className={`${styles.senderChip} ${styles.senderChipWarning}`}>Reconnect</span>
                  </div>
                  <span className={styles.senderEmail}>{sender.fromEmail}</span>
                </div>
                <a
                  className={`button secondary ${styles.reconnectButton}`}
                  href={`/api/auth/google/connect?email=${encodeURIComponent(sender.fromEmail)}&next=${encodeURIComponent("/campaigns/new")}`}
                >
                  Reconnect
                </a>
              </div>
            ))}

            <a
              className={`button${connectedSenders.length ? " secondary" : ""} ${styles.connectButton}`}
              href="/api/auth/google/connect"
            >
              <Plus aria-hidden="true" />
              {connectedSenders.length ? "Connect another Gmail" : "Connect Gmail"}
            </a>
          </div>
        </aside>
      </section>
    </div>
  );
}
