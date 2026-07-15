import { CheckCircle2 } from "lucide-react";

import { CampaignBuilder } from "@/components/campaign-builder";
import { ErrorToastOnMount } from "@/components/error-toast-provider";
import { requireOperatorUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getTemplateFormatLabel,
  templateContentToPlainText,
  TEMPLATE_FORMATS,
  type TemplateFormat
} from "@/lib/templates";
import { resolveBounceMonitoringStatus } from "@/services/bounces";
import styles from "./page.module.css";

function getSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function getMappedFields(mapping: { reservedFieldMap: unknown; variableMap: unknown } | undefined) {
  if (!mapping) {
    return [];
  }

  const fields = [mapping.reservedFieldMap, mapping.variableMap].flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    return Object.values(value).filter((field): field is string => typeof field === "string" && Boolean(field.trim()));
  });

  return Array.from(new Set(fields));
}

function normalizeTemplateFormat(format: string): TemplateFormat {
  return TEMPLATE_FORMATS.includes(format as TemplateFormat) ? (format as TemplateFormat) : "HTML";
}

function getTemplateSnippet(format: string, htmlBody: string) {
  const snippet = templateContentToPlainText(normalizeTemplateFormat(format), htmlBody)
    .replace(/\s+/g, " ")
    .trim();

  return snippet ? `${snippet.slice(0, 150)}${snippet.length > 150 ? "…" : ""}` : "No preview available.";
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
          <p>Choose an audience, shape the message, set the timing, then review.</p>
        </div>
      </header>

      <CampaignBuilder
        imports={imports.map((entry) => ({
          id: entry.id,
          label: entry.fileName,
          rowCount: entry.rowCount,
          mappedFields: getMappedFields(latestMappings.get(entry.id))
        }))}
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
        templates={templates.map((entry) => ({
          id: entry.id,
          label: entry.name,
          formatLabel: getTemplateFormatLabel(normalizeTemplateFormat(entry.format)),
          subject: entry.subject,
          snippet: getTemplateSnippet(entry.format, entry.htmlBody)
        }))}
        senders={connectedSenders.map((entry) => ({
          id: entry.id,
          label: `${entry.name} <${entry.fromEmail}>`,
          name: entry.name,
          email: entry.fromEmail,
          status: resolveBounceMonitoringStatus(entry),
          backfillCompleted: Boolean(entry.bounceBackfillCompletedAt)
        }))}
        disconnectedSenderCount={disconnectedSenders.length}
        reconnectHref={
          disconnectedSenders[0]
            ? `/api/auth/google/connect?email=${encodeURIComponent(disconnectedSenders[0].fromEmail)}&next=${encodeURIComponent("/campaigns/new")}`
            : undefined
        }
      />
    </div>
  );
}
