"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { UploadImportForm } from "@/components/forms";
import {
  TemplateFieldPicker,
  type TemplateFieldItem
} from "@/components/mapping-library";
import styles from "@/components/imports-workflow.module.css";

const WORKFLOW_STEPS = ["Upload", "Map fields", "Review"] as const;
type WorkflowStep = 0 | 1 | 2;

const STEP_CONTENT = [
  {
    eyebrow: "Step 1 of 3",
    title: "Upload people",
    description: "Add a CSV or spreadsheet to create an audience."
  },
  {
    eyebrow: "Step 2 of 3",
    title: "Map template fields",
    description: "Choose the fields you want to use for personalization."
  },
  {
    eyebrow: "Step 3 of 3",
    title: "Review your field setup",
    description: "Confirm the import and selected fields before saving."
  }
] as const;

type ImportsWorkflowProps = {
  imports: TemplateFieldItem[];
  initialImportId?: string;
  hasAnyImports: boolean;
};

export function ImportsWorkflow({ imports, initialImportId, hasAnyImports }: ImportsWorkflowProps) {
  const [activeStep, setActiveStep] = useState<WorkflowStep>(initialImportId ? 1 : 0);
  const [preferredImportId, setPreferredImportId] = useState(initialImportId);
  const [preparingImport, setPreparingImport] = useState(false);
  const [selectionReady, setSelectionReady] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);
  const step = STEP_CONTENT[activeStep];
  const canMap = imports.length > 0 || preparingImport;
  const canReview = selectionReady || reviewSaved;

  useEffect(() => {
    if (preferredImportId && imports.some((entry) => entry.importId === preferredImportId)) {
      setPreparingImport(false);
    }
  }, [imports, preferredImportId]);

  const handleSelectionChange = useCallback((ready: boolean) => {
    setSelectionReady(ready);
    if (ready) {
      setReviewSaved(false);
    }
  }, []);

  function openStep(nextStep: WorkflowStep) {
    if (nextStep === 1 && !canMap) {
      return;
    }
    if (nextStep === 2 && !canReview) {
      return;
    }
    setActiveStep(nextStep);
  }

  return (
    <section className={styles.workflowCard} id="import-upload" aria-labelledby="imports-workflow-title">
      <nav className={styles.stepNav} aria-label="Import workflow progress">
        <ol>
          {WORKFLOW_STEPS.map((label, index) => {
            const stepIndex = index as WorkflowStep;
            const isActive = activeStep === stepIndex;
            const isComplete = activeStep > stepIndex || (stepIndex === 2 && reviewSaved);
            const disabled = (stepIndex === 1 && !canMap) || (stepIndex === 2 && !canReview);

            return (
              <li key={label}>
                <button
                  className={`${styles.stepButton}${isActive ? ` ${styles.stepButtonActive}` : ""}${isComplete ? ` ${styles.stepButtonComplete}` : ""}`}
                  type="button"
                  aria-current={isActive ? "step" : undefined}
                  disabled={disabled}
                  onClick={() => openStep(stepIndex)}
                >
                  <span className={styles.stepNumber} aria-hidden="true">
                    {isComplete ? <Check /> : index + 1}
                  </span>
                  <span>{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <header className={styles.stepIntro} aria-live="polite">
        <span>{step.eyebrow}</span>
        <h2 id="imports-workflow-title" tabIndex={-1}>{step.title}</h2>
        <p>{step.description}</p>
      </header>

      <div className={styles.stepContent} hidden={activeStep !== 0} data-imports-tour="upload">
        <UploadImportForm
          onUploaded={(importId) => {
            setPreferredImportId(importId);
            setPreparingImport(true);
            setReviewSaved(false);
            setActiveStep(1);
          }}
        />
        {!hasAnyImports ? (
          <div className={styles.emptyNotice} role="status">
            <span className={styles.emptyNoticeIcon} aria-hidden="true">1</span>
            <span>
              <strong>No imports yet</strong>
              Upload a CSV or spreadsheet to start mapping fields.
            </span>
          </div>
        ) : null}
      </div>

      <div className={styles.stepContent} hidden={activeStep === 0} data-imports-tour="template-fields">
        {preparingImport && !imports.some((entry) => entry.importId === preferredImportId) ? (
          <div className={styles.loadingState} role="status" aria-live="polite">
            <LoaderCircle aria-hidden="true" />
            <span>
              <strong>Preparing field mapping</strong>
              Reading the columns in your import…
            </span>
            <span className={styles.loadingLine} aria-hidden="true" />
            <span className={styles.loadingLineShort} aria-hidden="true" />
          </div>
        ) : (
          <TemplateFieldPicker
            imports={imports}
            initialImportId={preferredImportId}
            view={activeStep === 2 ? "review" : "map"}
            onBack={() => setActiveStep(activeStep === 2 && !reviewSaved ? 1 : 0)}
            onContinue={() => setActiveStep(2)}
            onSelectionChange={handleSelectionChange}
            onSaved={() => {
              setReviewSaved(true);
              setSelectionReady(false);
            }}
          />
        )}
      </div>
    </section>
  );
}
