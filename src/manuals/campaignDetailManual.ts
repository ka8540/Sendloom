import { quickAndFullSteps } from "@/components/manual/manualSteps";
import type { ManualConfig } from "@/components/manual/manualTypes";

export const campaignDetailManual: ManualConfig = {
  id: "campaign-detail",
  routeLabel: "Sequence detail",
  helpLabel: "Help with Sequences",
  helpTooltip: "Sequence guide",
  helpVariant: "premium",
  helpQuickStart: true,
  helpQuickStartDescription:
    "Check run status, validate, check bounces, pause or relaunch, edit setup, review activity, and delete only when needed.",
  quickStartStage: "starter",
  fullTourStage: "full",
  version: "v3",
  resolveStage: () => "starter",
  resolveSteps: (stage) => quickAndFullSteps(campaignDetailManual.steps, 3)(stage),
  steps: [
    {
      id: "overview",
      title: "Sequence overview",
      body: "See the sequence name and status alongside its audience, template, sender, and send timing.",
      selector: '[data-tour-sequence-detail="overview"]',
      placement: "bottom"
    },
    {
      id: "run-health",
      title: "Run health and status",
      body: "Read send timing, validation status, current run state, and the live auto-refresh indicator while a run is active.",
      selector: '[data-tour-sequence-detail="run-health"]',
      placement: "bottom"
    },
    {
      id: "actions",
      title: "Action controls",
      body: "Refresh validation, check bounces, pause or relaunch, edit the sequence, retry failed recipients when available, or delete the sequence when needed.",
      selector: '[data-tour-sequence-detail="actions"]',
      placement: "left"
    },
    {
      id: "metrics",
      title: "Delivery stats",
      body: "Track audience size, delivered emails, and recipients skipped because they are invalid or excluded.",
      selector: '[data-tour-sequence-detail="delivery-stats"]',
      placement: "bottom"
    },
    {
      id: "setup",
      title: "Sequence setup",
      body: "Confirm the contact list, email template, sender account, send timing, and attachment preview or download options.",
      selector: '[data-tour-sequence-detail="setup"]',
      placement: "right"
    },
    {
      id: "recipients",
      title: "Recent recipient activity",
      body: "Review each recipient’s queued, sent, opened, invalid, or skipped state, including the latest status message and pagination.",
      selector: '[data-tour-sequence-detail="recipient-activity"]',
      placement: "left"
    }
  ]
};
