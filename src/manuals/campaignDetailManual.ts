import { quickAndFullSteps } from "@/components/manual/manualSteps";
import type { ManualConfig } from "@/components/manual/manualTypes";

export const campaignDetailManual: ManualConfig = {
  id: "campaign-detail",
  routeLabel: "Sequence detail",
  helpLabel: "Help with Sequences",
  helpTooltip: "Sequence guide",
  helpVariant: "premium",
  helpMenuItems: [
    {
      title: "Sequence overview",
      description: "View the sequence name, status, audience, template, sender, timing, and current run state.",
      icon: "overview"
    },
    {
      title: "Run controls",
      description: "Refresh validation, check bounces, pause, relaunch, edit, or delete this sequence.",
      icon: "controls"
    },
    {
      title: "Delivery stats",
      description: "Track audience size, delivered emails, and skipped or invalid recipients.",
      icon: "stats"
    },
    {
      title: "Recipient activity",
      description: "Review each recipient’s latest status, including queued, sent, opened, invalid, or skipped.",
      icon: "activity"
    },
    {
      title: "Setup details",
      description: "Confirm the contact list, email template, sender account, timing, and attachments.",
      icon: "setup"
    },
    {
      title: "Need help?",
      description: "Report an issue if something looks wrong on this sequence.",
      icon: "help",
      action: "report"
    }
  ],
  helpQuickStart: true,
  quickStartStage: "starter",
  fullTourStage: "full",
  version: "v2",
  resolveStage: () => "starter",
  resolveSteps: (stage) => quickAndFullSteps(campaignDetailManual.steps, 2)(stage),
  steps: [
    {
      id: "overview",
      title: "Monitor one sequence",
      body: "This detail view is the operating record for a sequence: setup context, sender state, schedule, validation, and current run status in one place.",
      selector: "main.content section:first-of-type",
      placement: "bottom"
    },
    {
      id: "controls",
      title: "Validate, pause, or launch",
      body: "Use validation before sending, pause active work when needed, and launch only when the sender is connected and setup is unlocked.",
      selector: "main.content form button, main.content a.button",
      placement: "left"
    },
    {
      id: "metrics",
      title: "Read delivery state",
      body: "Audience, delivered count, replies, and needs-attention metrics summarize whether the run is moving cleanly or requires operator review.",
      selector: "main.content section:nth-of-type(2)",
      placement: "bottom"
    },
    {
      id: "recipients",
      title: "Inspect recipient activity",
      body: "Recipient rows expose the actual delivery state, last error, reply matching, and pagination for the latest run so issues can be handled precisely.",
      selector: "main.content article:last-of-type",
      placement: "left"
    }
  ]
};
