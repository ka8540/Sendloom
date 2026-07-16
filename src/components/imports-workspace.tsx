"use client";

import { FileSpreadsheet, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ImportsWorkflow } from "@/components/imports-workflow";
import {
  MappingLibrary,
  type MappingLibraryItem,
  type TemplateFieldItem
} from "@/components/mapping-library";
import { WorkspacePageHeader } from "@/components/workspace-page-header";

type ImportsMode = "library" | "workflow";

type ImportsWorkspaceProps = {
  workflowItems: TemplateFieldItem[];
  mappingItems: MappingLibraryItem[];
  initialImportId?: string;
  hasAnyImports: boolean;
};

export function ImportsWorkspace({
  workflowItems,
  mappingItems,
  initialImportId,
  hasAnyImports
}: ImportsWorkspaceProps) {
  const router = useRouter();
  const [mode, setMode] = useState<ImportsMode>(initialImportId ? "workflow" : "library");

  // An explicit import context (including Discover's pendingImportId) always
  // opens that import directly in Map fields, even after client navigation.
  useEffect(() => {
    if (initialImportId) {
      setMode("workflow");
    }
  }, [initialImportId]);

  function openLibrary() {
    setMode("library");
    if (initialImportId) {
      router.replace("/imports");
    }
  }

  function openWorkflow() {
    setMode("workflow");
  }

  return (
    <div className="imports-dashboard">
      <WorkspacePageHeader
        title="Imports"
        subtitle="Upload, map, and manage the people lists that power your sequences."
        actions={mode === "library" ? (
          <button className="button" type="button" data-imports-tour="add-import" onClick={openWorkflow}>
            <Plus aria-hidden="true" />
            Add import
          </button>
        ) : undefined}
      />

      {mode === "workflow" ? (
        <ImportsWorkflow
          imports={workflowItems}
          initialImportId={initialImportId}
          hasAnyImports={hasAnyImports}
          onExit={openLibrary}
        />
      ) : (
        <section
          className="card imports-library-shell"
          data-imports-tour="imports-list"
          aria-labelledby="imports-library-heading"
        >
          <header className="imports-library-shell__header">
            <div className="imports-library-shell__heading">
              <div className="imports-library-shell__title">
                <span className="imports-library-shell__icon" aria-hidden="true">
                  <FileSpreadsheet />
                </span>
                <h2 id="imports-library-heading">Saved imports</h2>
                <span className="imports-library-shell__count" aria-label={`${mappingItems.length} saved imports`}>
                  {mappingItems.length}
                </span>
              </div>
              <p>People lists ready to review, edit, or use in a sequence.</p>
            </div>
          </header>
          <MappingLibrary items={mappingItems} onAddImport={openWorkflow} />
        </section>
      )}
    </div>
  );
}
