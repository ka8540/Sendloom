import type { ManualConfig, ManualStep } from "@/components/manual/manualTypes";

// Imports (/imports) guided help. Three menu modes share one config:
//   - "starter" → a short Quick start (upload → choose fields → save → it appears)
//   - "full"    → the complete page tour, adapted to the visible state
//   - "changed" → a contextual tour of the processed card + pencil editor, offered
//                 once the user has at least one processed import
//
// Every step targets a stable `data-imports-tour="..."` attribute. State-dependent
// steps (the pending picker, and everything tied to a processed card) are
// `optional`, so the overlay drops them when their target is absent. The single
// pencil action is now the only edit entry point (there is no separate
// fields-only button), so the guide always routes field changes to the pencil.
// Copy is product-facing: it never mentions operators, backends, or internals.

function sel(target: string): string {
  return `[data-imports-tour="${target}"]`;
}

// ---- Reusable steps --------------------------------------------------------

function uploadStep(): ManualStep {
  return {
    id: "upload",
    title: "Start with your people list",
    body: "Imports are the starting point for outreach. Upload a CSV or spreadsheet and Sendloom reads the file and prepares its recipient rows for review.",
    selector: sel("upload"),
    placement: "right"
  };
}

function templateFieldsStep(): ManualStep {
  return {
    id: "template-fields",
    title: "Choose template fields",
    body: "After a file is read, pick the columns templates can personalize against — names, companies, and any custom variables you want available at send time.",
    selector: sel("template-fields"),
    placement: "left"
  };
}

function pendingSelectorStep(): ManualStep {
  return {
    id: "pending-selector",
    title: "Pick an import to set up",
    body: "Imports still awaiting field selection appear in this list. Choose one to review its detected columns before it becomes a processed import.",
    selector: sel("pending-selector"),
    placement: "left",
    optional: true
  };
}

function activeFieldSelectionStep(): ManualStep {
  return {
    id: "active-field-selection",
    title: "Select the fields to activate",
    body: "Check the columns that should be available as template variables. Columns you leave unchecked stay stored with the import and can be activated later.",
    selector: sel("active-field-selection"),
    placement: "left",
    optional: true
  };
}

function saveTemplateFieldsStep(): ManualStep {
  return {
    id: "save-template-fields",
    title: "Save the template fields",
    body: "Saving the selected fields finalizes the import. It then appears as a processed import in the list below, ready to power a sequence.",
    selector: sel("save-template-fields"),
    placement: "left",
    optional: true
  };
}

function importsListStep(): ManualStep {
  return {
    id: "imports-list",
    title: "Manage your imported audiences",
    body: "Processed imports appear here after their template fields are saved. Each card shows the audience size, sequence usage, active template fields, detected columns, and sample contacts.",
    selector: sel("imports-list"),
    placement: "top"
  };
}

function importCardStep(): ManualStep {
  return {
    id: "import-card",
    title: "Review an existing import",
    body: "This card summarizes the import name, status, contact count, sequence usage, selected template fields, other detected columns, and sample contacts.",
    selector: sel("import-card"),
    placement: "top",
    optional: true
  };
}

function editImportStep(): ManualStep {
  return {
    id: "edit-import",
    title: "Edit this import",
    body: "Use the pencil to rename the import or change which detected columns are active template fields. Your contacts and existing sequence associations remain attached to the same import.",
    selector: sel("edit-import"),
    placement: "left",
    optional: true
  };
}

function activeTemplateFieldsStep(): ManualStep {
  return {
    id: "active-template-fields",
    title: "Active template fields",
    body: "These fields can be used as merge variables when creating email templates. Use the import's pencil action whenever you need to change the selection.",
    selector: sel("active-template-fields"),
    placement: "top",
    optional: true
  };
}

function otherDetectedColumnsStep(): ManualStep {
  return {
    id: "other-detected-columns",
    title: "Other detected columns",
    body: "These columns are still stored in the import but are not currently active as template fields. You can activate them later through the pencil editor.",
    selector: sel("other-detected-columns"),
    placement: "top",
    optional: true
  };
}

function sampleContactsStep(): ManualStep {
  return {
    id: "sample-contacts",
    title: "Preview the audience",
    body: "Sample contacts provide a quick check of the people and data contained in the import without opening or modifying the full list.",
    selector: sel("sample-contacts"),
    placement: "top",
    optional: true
  };
}

function deleteImportStep(): ManualStep {
  return {
    id: "delete-import",
    title: "Delete an import",
    body: "The trash icon removes an import after you confirm. Because any sequences built from it are removed too, deleting is reserved for audiences you no longer need.",
    selector: sel("delete-import"),
    placement: "left",
    optional: true
  };
}

function paginationStep(): ManualStep {
  return {
    id: "imports-pagination",
    title: "Browse more imports",
    body: "When you have several imports, use these controls to page through them.",
    selector: sel("imports-pagination"),
    placement: "top",
    optional: true
  };
}

// ---- Stage builders --------------------------------------------------------

/**
 * Quick start — upload → choose fields → save → it appears below. The pencil edit
 * step is appended but `optional`, so a first-time user with no processed import
 * never sees it (the overlay filters it out); a user who already has one gets the
 * short edit explainer.
 */
export function importsQuickSteps(): ManualStep[] {
  return [
    uploadStep(),
    templateFieldsStep(),
    saveTemplateFieldsStep(),
    {
      id: "imports-list",
      title: "Your processed imports land here",
      body: "Once template fields are saved, the import appears in the list below with its contacts and template fields, ready to power a sequence.",
      selector: sel("imports-list"),
      placement: "top"
    },
    editImportStep()
  ];
}

/** Full tour — every visible section and control, adapted to the page state. */
export function importsFullSteps(): ManualStep[] {
  return [
    uploadStep(),
    templateFieldsStep(),
    pendingSelectorStep(),
    activeFieldSelectionStep(),
    saveTemplateFieldsStep(),
    importsListStep(),
    importCardStep(),
    activeTemplateFieldsStep(),
    otherDetectedColumnsStep(),
    sampleContactsStep(),
    editImportStep(),
    deleteImportStep(),
    paginationStep()
  ];
}

/**
 * Contextual "what changed" — shown once the user has a processed import. Explains
 * that the import now sits in the list (with sequence usage), that the pencil edits
 * both the name and the fields, and that sample contacts give a quick preview.
 */
export function importsChangedSteps(): ManualStep[] {
  return [importCardStep(), editImportStep(), sampleContactsStep()];
}

export function importsStepsForStage(stage: string | null): ManualStep[] {
  if (stage === "full") {
    return importsFullSteps();
  }
  if (stage === "changed") {
    return importsChangedSteps();
  }
  return importsQuickSteps();
}

export const importsManual: ManualConfig = {
  id: "imports",
  routeLabel: "Imports",
  helpLabel: "Help with Imports",
  helpTooltip: "Imports guide",
  helpVariant: "premium",
  helpQuickStart: true,
  quickStartStage: "starter",
  fullTourStage: "full",
  version: "v3",
  steps: importsQuickSteps(),
  // First-time auto-open shows the short quick start once.
  resolveStage: () => "starter",
  resolveSteps: (stage) => importsStepsForStage(stage)
};
