"use client";

import { FileSpreadsheet, Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ImportsWorkflow } from "@/components/imports-workflow";
import { hasImportWorkflowContext } from "@/components/imports-workflow-selection";
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
  missingImportId?: string;
  hasAnyImports: boolean;
};

export function ImportsWorkspace({
  workflowItems,
  mappingItems,
  initialImportId,
  missingImportId,
  hasAnyImports
}: ImportsWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<ImportsMode>(initialImportId || missingImportId ? "workflow" : "library");
  const [searchQuery, setSearchQuery] = useState("");

  // The workflow is always URL-identifiable: import context ids (including
  // Discover's pendingImportId) arrive from links, and Add import stamps
  // step=upload. An explicit context always opens the workflow — a context id
  // that can't be resolved still does, so the "import not found" state is
  // shown instead of silently falling back to the library. Syncing mode both
  // ways lets any explicit navigation to plain /imports (the shell back
  // button, Back to imports) land on the library instead of replaying
  // browser history.
  const inWorkflowRoute = Boolean(initialImportId || missingImportId) || hasImportWorkflowContext(searchParams);

  useEffect(() => {
    setMode(inWorkflowRoute ? "workflow" : "library");
  }, [inWorkflowRoute]);

  function openLibrary() {
    setMode("library");
    if (inWorkflowRoute) {
      router.replace("/imports");
    }
  }

  function openWorkflow() {
    setMode("workflow");
    router.push("/imports?step=upload");
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
          missingImportId={missingImportId}
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
            {mappingItems.length ? (
              <label className="imports-library__search" aria-label="Search imports">
                <Search aria-hidden="true" />
                <input
                  type="search"
                  value={searchQuery}
                  placeholder="Search lists, fields, or contacts..."
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                {searchQuery ? (
                  <button type="button" aria-label="Clear import search" onClick={() => setSearchQuery("")}>
                    <X aria-hidden="true" />
                  </button>
                ) : null}
              </label>
            ) : null}
          </header>
          <MappingLibrary
            items={mappingItems}
            onAddImport={openWorkflow}
            searchQuery={searchQuery}
            onClearSearch={() => setSearchQuery("")}
          />
        </section>
      )}
    </div>
  );
}
