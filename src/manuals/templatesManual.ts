import type { ManualConfig, ManualStep } from "@/components/manual/manualTypes";

/**
 * The Templates area presents three surfaces that all live under the `/templates`
 * URL: the saved-template library, the wizard's Compose step, and the wizard's
 * Preview / Review step. The wizard is driven by internal React state, not the
 * route, so the shared manual can't tell them apart from the pathname alone.
 * Instead we read a DOM marker the wizard publishes (`data-template-step`) to
 * resolve the current surface, and hand back a guide written for exactly that
 * surface — so the Help button always explains what the user is actually looking
 * at instead of one generic "templates" card.
 */
export type TemplateManualStage = "library" | "compose" | "review";

const librarySteps: ManualStep[] = [
  {
    id: "library-intro",
    title: "Template library",
    body: "Templates are reusable email messages — a subject line and a body — that your campaigns and sequences send. Build a message once here and reuse it across every sequence.",
    selector: ".templates-library__hero",
    placement: "bottom"
  },
  {
    id: "library-search",
    title: "Search and manage templates",
    body: "Search by template name, subject, or body preview to find a message fast. Open any card's Edit button to reopen it and refine the copy.",
    selector: ".saved-templates__search",
    placement: "bottom"
  },
  {
    id: "library-create",
    title: "Create a new template",
    body: "Create new template starts a guided flow: compose the message, then preview and review exactly how it reads before it is saved.",
    selector: ".templates-library__create",
    placement: "left"
  },
  {
    id: "library-merge",
    title: "Use merge fields",
    body: "Variables like {{name}} and {{company}} stay as placeholders in a template and are filled from your mapped contact-list fields when a campaign sends.",
    selector: ".templates-list",
    placement: "top"
  }
];

const composeSteps: ManualStep[] = [
  {
    id: "compose-basics",
    title: "Compose your template",
    body: "Give the template a name, choose a message format, then write the subject and body your sequences will send.",
    selector: "[data-template-tour='compose-basics'], input[name='name']",
    placement: "bottom"
  },
  {
    id: "compose-personalization",
    title: "Use personalization",
    body: "Drop in merge fields such as {{name}} and {{company}} — plus any other variable mapped from your contact list. They stay as placeholders now and fill with real contact data on send.",
    selector: "[data-template-tour='compose-personalization'], input[name='subject']",
    placement: "top"
  },
  {
    id: "compose-tools",
    title: "AI and spam check",
    body: "Check spam scores the copy for deliverability, and AI enhancement can tighten the subject or body with that score in mind. Both are optional and run before you save.",
    selector: "[data-template-tour='compose-tools'], .template-check-spam-button",
    placement: "bottom"
  },
  {
    id: "compose-next",
    title: "Next to preview",
    body: "Nothing is saved yet. Next: Preview opens a full review where you can read the finished message before creating it.",
    selector: "[data-template-tour='compose-next']",
    placement: "top"
  }
];

const reviewSteps: ManualStep[] = [
  {
    id: "review-summary",
    title: "Review before saving",
    body: "This step lays out the final template details — name, format, subject, length, and the variables it uses — so you can confirm everything before it is saved.",
    selector: "[data-template-tour='review-summary'], .template-review-summary",
    placement: "right"
  },
  {
    id: "review-preview",
    title: "Email preview",
    body: "The recipient view renders the subject and body exactly as they will send — including line breaks and lists — with merge fields shown as safe sample values.",
    selector: "[data-template-tour='review-preview'], .template-email-review",
    placement: "left"
  },
  {
    id: "review-back",
    title: "Go back to edit",
    body: "Back to Compose returns you to the editor with everything you wrote still in place, so you can adjust the copy and come straight back here.",
    selector: "[data-template-tour='review-back']",
    placement: "top"
  },
  {
    id: "review-save",
    title: "Save template",
    body: "Create template — or Save changes when editing — stores the template and returns you to the library, ready to attach to a sequence.",
    selector: "[data-template-tour='review-save']",
    placement: "top"
  }
];

const stepsByStage: Record<TemplateManualStage, ManualStep[]> = {
  library: librarySteps,
  compose: composeSteps,
  review: reviewSteps
};

/**
 * Resolve which Templates surface is on screen. The wizard form publishes
 * `data-template-step="compose|review"`; when it is absent we are on the saved
 * library. Pure DOM read, safe during SSR (returns the library default).
 */
export function resolveTemplateStage(): TemplateManualStage {
  if (typeof document === "undefined") {
    return "library";
  }

  const marker = document.querySelector("[data-template-step]")?.getAttribute("data-template-step");
  if (marker === "review") {
    return "review";
  }
  if (marker === "compose") {
    return "compose";
  }

  return "library";
}

function isTemplateStage(stage: string | null): stage is TemplateManualStage {
  return stage === "library" || stage === "compose" || stage === "review";
}

export const templatesManual: ManualConfig = {
  id: "templates",
  routeLabel: "Templates",
  helpLabel: "Help with Templates",
  helpTooltip: "Templates guide",
  helpVariant: "premium",
  // The wizard shares the /templates URL, so the guide-menu action must resolve
  // the current surface (library / compose / review) at click time.
  contextualStages: true,
  version: "v3",
  resolveStage: resolveTemplateStage,
  resolveSteps: (stage) => stepsByStage[isTemplateStage(stage) ? stage : "library"],
  steps: librarySteps
};
