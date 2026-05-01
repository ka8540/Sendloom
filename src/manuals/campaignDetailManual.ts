import type { ManualConfig } from "@/components/manual/manualTypes";

export const campaignDetailManual: ManualConfig = {
  id: "campaign-detail",
  routeLabel: "Sequence detail",
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
