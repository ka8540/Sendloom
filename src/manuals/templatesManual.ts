import type { ManualConfig } from "@/components/manual/manualTypes";

export const templatesManual: ManualConfig = {
  id: "templates",
  routeLabel: "Templates",
  helpLabel: "Help with Templates",
  helpTooltip: "Templates guide",
  steps: [
    {
      id: "editor",
      title: "Create reusable email assets",
      body: "Templates define the subject and body that campaigns send. Keep the copy reusable and leave personalization to mapped variables such as {{name}} or {{company}}.",
      selector: "input[name='name'], input[name='subject']",
      placement: "right"
    },
    {
      id: "formats",
      title: "Pick the right format",
      body: "Use plain text for direct outreach, HTML when layout matters, and JSON when the message comes from a structured workflow or generated content.",
      selector: "select[name='format']",
      placement: "right"
    },
    {
      id: "cleanup",
      title: "Tighten before launch",
      body: "Run a spam pass, then use AI enhancement to clean up the subject or body with that delivery score in mind before attaching the template to a sequence.",
      selector: ".template-check-spam-button, button[aria-label*='Enhance']",
      placement: "bottom"
    },
    {
      id: "preview",
      title: "Preview what operators will send",
      body: "The live preview shows the actual rendered message and detected variables, so you can spot missing fields before campaigns use the template.",
      selector: ".template-preview-card, .template-preview-mail",
      placement: "left"
    }
  ]
};
