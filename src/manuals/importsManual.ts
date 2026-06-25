import type { ManualConfig } from "@/components/manual/manualTypes";

export const importsManual: ManualConfig = {
  id: "imports",
  routeLabel: "Imports",
  helpLabel: "Help with Imports",
  helpTooltip: "Imports guide",
  steps: [
    {
      id: "upload",
      title: "Start with the list",
      body: "Imports are the campaign starting point. Upload a CSV or spreadsheet first; Sendloom reads the file and prepares recipient rows for mapping.",
      selector: "input[type='file'][name='file']",
      placement: "right"
    },
    {
      id: "field-selection",
      title: "Choose template fields",
      body: "After upload, pick the columns that templates can personalize against. Good mapping keeps names, companies, and any custom variables consistent during send time.",
      selector: "main.content article.card:nth-of-type(2), main.content select",
      placement: "left"
    },
    {
      id: "library",
      title: "Manage imported audiences",
      body: "The imports list is where operators review records, rename files, update field selections, and keep only audiences that are ready for a sequence.",
      selector: "main.content section.card:last-of-type",
      placement: "top"
    }
  ]
};
