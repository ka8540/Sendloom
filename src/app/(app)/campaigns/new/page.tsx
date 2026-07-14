import { CheckCircle2, Mail, RefreshCcw } from "lucide-react";

import { CampaignBuilder } from "@/components/campaign-builder";
import { ErrorToastOnMount } from "@/components/error-toast-provider";
import { BounceMonitoringStatus } from "@/components/senders/bounce-monitoring-status";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveBounceMonitoringStatus } from "@/services/bounces";
import styles from "./page.module.css";

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

      <section className={styles.topGrid}>
        <article className={styles.builderCard} id="create-sequence">
          <div className={styles.panelHeading}>
            <span className={styles.kicker}>Build</span>
            <h1>Create a sequence</h1>
            <p>Pick a contact list, template, sender, and send timing, then launch.</p>
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
            <span className={styles.kicker}>Senders</span>
            <h2>Send from Gmail</h2>
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
                  className="button secondary"
                  href={`/api/auth/google/connect?email=${encodeURIComponent(sender.fromEmail)}&next=${encodeURIComponent("/campaigns/new")}`}
                >
                  Reconnect
                </a>
              </div>
            ))}

            <a className="button" href="/api/auth/google/connect">
              {connectedSenders.length ? "Connect another Gmail" : "Connect Gmail"}
            </a>
          </div>
        </aside>
      </section>
    </div>
  );
}
