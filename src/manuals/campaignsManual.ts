import type { ManualConfig } from "@/components/manual/manualTypes";

export const campaignsManual: ManualConfig = {
  id: "campaigns",
  routeLabel: "Sequences",
  helpLabel: "Help with Sequences",
  helpTooltip: "Sequences guide",
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
      id: "board",
      title: "Watch configured sequences",
      body: "The sequence board shows validation, timing, latest run state, and delivery posture so operators can reopen the right workflow quickly.",
      selector: "a[href^='/campaigns/']",
      placement: "top"
    }
  ]
};
