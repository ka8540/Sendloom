import { quickAndFullSteps } from "@/components/manual/manualSteps";
import type { ManualConfig } from "@/components/manual/manualTypes";

// The Sequences dashboard guide (/campaigns). The create form now lives on
// its own page (/campaigns/new) and gets the campaignCreateManual below.
export const campaignsManual: ManualConfig = {
  id: "campaigns",
  routeLabel: "Sequences",
  helpLabel: "Help with Sequences",
  helpTooltip: "Sequences guide",
  helpVariant: "premium",
  helpQuickStart: true,
  quickStartStage: "starter",
  fullTourStage: "full",
  version: "v3",
  resolveStage: () => "starter",
  resolveSteps: (stage) => quickAndFullSteps(campaignsManual.steps, 2)(stage),
  steps: [
    {
      id: "create",
      title: "Start a new sequence",
      body: "New sequence opens the create page, where you combine one import, its saved mapping, one template, and one connected Gmail sender.",
      selector: "a[href='/campaigns/new']",
      placement: "bottom"
    },
    {
      id: "health",
      title: "Check sequences health",
      body: "The health panel lists sequences with failed runs, failed sends, or invalid recipients. When nothing needs attention it shows all clear.",
      selector: "[aria-label='Sequences health']",
      placement: "left"
    },
    {
      id: "summary",
      title: "Read the summary cards",
      body: "Active sequences, replies received, emails sent in the last 24 hours, and queued runs — the day's posture at a glance.",
      selector: "[aria-label='Sequence overview']",
      placement: "bottom"
    },
    {
      id: "find",
      title: "Search and filter the list",
      body: "Search matches name, contact list, template, and sender. The status filters show live counts and combine with search.",
      selector: "[aria-label='Filter sequences by status']",
      placement: "bottom"
    },
    {
      id: "rows",
      title: "Open a sequence",
      body: "Each row shows status, current state, progress, and delivery metrics. Click a row to open the full detail page.",
      selector: "[aria-label='Sequence list'] a[href^='/campaigns/']",
      placement: "top"
    }
  ]
};

// The Create Sequence page guide (/campaigns/new).
export const campaignCreateManual: ManualConfig = {
  id: "campaign-create",
  routeLabel: "Create sequence",
  helpLabel: "Help with creating a sequence",
  helpTooltip: "Create sequence guide",
  helpVariant: "premium",
  helpQuickStart: true,
  quickStartStage: "starter",
  fullTourStage: "full",
  version: "v1",
  resolveStage: () => "starter",
  resolveSteps: (stage) => quickAndFullSteps(campaignCreateManual.steps, 2)(stage),
  steps: [
    {
      id: "builder",
      title: "Build the sequence",
      body: "A sequence combines one import, its saved mapping, one template, and one connected sender. If any part is missing, fix that upstream before launch.",
      selector: "input[name='name']",
      placement: "right"
    },
    {
      id: "assets",
      title: "Select list, template, and sender",
      body: "Choose the audience, template, and Gmail sender deliberately. The selected mapping controls which fields can personalize the outgoing emails.",
      selector: "select[name='importId'], select[name='templateId'], select[name='senderProfileId']",
      placement: "right"
    },
    {
      id: "schedule",
      title: "Control launch timing",
      body: "Send now starts immediately after launch. One-time and recurring schedules queue delivery for the selected timezone instead of sending right away.",
      selector: "select[name='scheduleType']",
      placement: "right"
    },
    {
      id: "senders",
      title: "Manage Gmail senders",
      body: "Connected senders appear here with their bounce-monitoring status. Connect another Gmail account any time without leaving the page.",
      selector: "[aria-label='Send from Gmail']",
      placement: "left"
    }
  ]
};
