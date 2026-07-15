"use client";

import { Braces, ChevronLeft, ChevronRight, Code2, FileText, Pencil, Plus, Search, SearchX, Type, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { TemplateForm, type EditableTemplate, type TemplateDraft } from "@/components/forms";
import { WorkspacePageHeader } from "@/components/workspace-page-header";
import { getDefaultTemplateBody, getTemplateFormatLabel, templateContentToPlainText, type TemplateFormat } from "@/lib/templates";
import type { MergeVariables } from "@/lib/types";

const DEFAULT_TEMPLATE_DRAFT: TemplateDraft = {
  name: "",
  subject: "",
  format: "PLAIN_TEXT",
  htmlBody: getDefaultTemplateBody("PLAIN_TEXT"),
  previewPayload: null
};
const TEMPLATE_PAGE_SIZE = 5;

type LibraryTemplate = EditableTemplate & {
  updatedAt?: string;
};

function normalizePreviewPayload(payload: MergeVariables | null | undefined) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))
  ) as MergeVariables;
}

function normalizeTemplate(template: LibraryTemplate): LibraryTemplate {
  return {
    ...template,
    format: (template.format ?? DEFAULT_TEMPLATE_DRAFT.format) as TemplateFormat,
    variableManifest: Array.isArray(template.variableManifest) ? template.variableManifest : [],
    previewPayload: normalizePreviewPayload(template.previewPayload)
  };
}

function createDraft(template?: EditableTemplate | null): TemplateDraft {
  const format = (template?.format ?? DEFAULT_TEMPLATE_DRAFT.format) as TemplateFormat;
  return {
    name: template?.name ?? DEFAULT_TEMPLATE_DRAFT.name,
    subject: template?.subject ?? DEFAULT_TEMPLATE_DRAFT.subject,
    format,
    htmlBody: template?.htmlBody ?? getDefaultTemplateBody(format),
    previewPayload: normalizePreviewPayload(template?.previewPayload)
  };
}

function getTemplateFormatIcon(format: TemplateFormat) {
  if (format === "PLAIN_TEXT") {
    return Type;
  }

  if (format === "JSON") {
    return Braces;
  }

  return Code2;
}

function getTemplateCardContent(format: TemplateFormat, body: string) {
  const plainText = templateContentToPlainText(format, body).trim();
  const collapsed = plainText.replace(/\s+/g, " ");
  const wordCount = plainText ? plainText.split(/\s+/).length : 0;

  return {
    bodyPreview: collapsed || "No body content yet.",
    wordCount,
    readingMinutes: wordCount ? Math.max(1, Math.ceil(wordCount / 200)) : 0
  };
}

function formatUpdatedDate(value?: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

export function TemplatesWorkspace({ templates: initialTemplates }: { templates: LibraryTemplate[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [templates, setTemplates] = useState(initialTemplates.map(normalizeTemplate));
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState<TemplateDraft>(createDraft(null));
  const wizardOpen = searchParams.get("wizard") === "template";

  useEffect(() => {
    setTemplates(initialTemplates.map(normalizeTemplate));
  }, [initialTemplates]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredTemplates = useMemo(() => {
    if (!normalizedSearchQuery) {
      return templates;
    }

    return templates.filter((template) => {
      const haystack = [template.name, template.format, getTemplateFormatLabel(template.format), template.subject].join(" ").toLowerCase();

      return haystack.includes(normalizedSearchQuery);
    });
  }, [templates, normalizedSearchQuery]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredTemplates.length / TEMPLATE_PAGE_SIZE));
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [filteredTemplates.length]);

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedSearchQuery]);

  const editingTemplate = templates.find((template) => template.id === editingTemplateId) ?? null;
  const totalPages = Math.max(1, Math.ceil(filteredTemplates.length / TEMPLATE_PAGE_SIZE));
  const pagedTemplates = filteredTemplates.slice((currentPage - 1) * TEMPLATE_PAGE_SIZE, currentPage * TEMPLATE_PAGE_SIZE);
  const hasTemplates = templates.length > 0;
  const isSearching = normalizedSearchQuery.length > 0;
  const hasNoResults = isSearching && filteredTemplates.length === 0;
  const pageRangeStart = filteredTemplates.length ? (currentPage - 1) * TEMPLATE_PAGE_SIZE + 1 : 0;
  const pageRangeEnd = Math.min(filteredTemplates.length, currentPage * TEMPLATE_PAGE_SIZE);

  const handleSaved = (savedTemplate: EditableTemplate) => {
    const normalized = normalizeTemplate({ ...savedTemplate, updatedAt: new Date().toISOString() });

    setTemplates((currentTemplates) => {
      const nextTemplates = currentTemplates.filter((template) => template.id !== normalized.id);
      return [normalized, ...nextTemplates];
    });
    setCurrentPage(1);
    setEditingTemplateId(null);
    setDraft(createDraft(null));
    router.replace("/templates");
    router.refresh();
  };

  const handleStartCreating = () => {
    setEditingTemplateId(null);
    setDraft(createDraft(null));
    router.push("/templates?wizard=template");
  };

  const handleStartEditing = (template: EditableTemplate) => {
    setEditingTemplateId(template.id);
    setDraft(createDraft(template));
    router.push("/templates?wizard=template");
  };

  const handleCloseWizard = () => {
    setEditingTemplateId(null);
    setDraft(createDraft(null));
    router.push("/templates");
  };

  if (wizardOpen) {
    return (
      <div className="template-wizard-page">
        <header className="template-wizard-page__header">
          <div className="template-wizard-page__heading">
            <span className="template-wizard-page__kicker">Template workflow</span>
            <h1>{editingTemplate ? "Edit template" : "Create template"}</h1>
            <p>
              {editingTemplate
                ? "Refine the saved message, then review the updated version."
                : "Write, review, and save a reusable message."}
            </p>
          </div>
        </header>

        <TemplateForm
          initialTemplate={editingTemplate}
          value={draft}
          onChange={setDraft}
          onSaved={handleSaved}
          onCancel={handleCloseWizard}
        />
      </div>
    );
  }

  return (
    <div className="templates-library">
      <WorkspacePageHeader
        title="Templates"
        subtitle="Create, find, and refine the messages used across your sequences."
        actions={
          <button className="button" type="button" onClick={handleStartCreating}>
            <Plus aria-hidden="true" />
            Create new template
          </button>
        }
      />

      <section className="card templates-library__card" aria-labelledby="saved-templates-heading">
        <div className="saved-templates__header">
          <div className="saved-templates__heading">
            <div className="saved-templates__title">
              <h2 id="saved-templates-heading">Saved templates</h2>
              <span className="saved-templates__count" aria-label={`${templates.length} saved templates`}>
                {templates.length}
              </span>
            </div>
            <p>
              {isSearching
                ? filteredTemplates.length
                  ? `${filteredTemplates.length} ${filteredTemplates.length === 1 ? "match" : "matches"} for “${searchQuery.trim()}”`
                  : `No matches for “${searchQuery.trim()}”`
                : "Reusable messages ready for your sequences."}
            </p>
          </div>
          <label className="saved-templates__search" aria-label="Search saved templates">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              placeholder="Search templates..."
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery ? (
              <button
                type="button"
                className="saved-templates__search-clear"
                aria-label="Clear template search"
                onClick={() => setSearchQuery("")}
              >
                <X aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </div>

        <div className="templates-list">
          {pagedTemplates.map((template, index) => {
            const cardContent = getTemplateCardContent(template.format, template.htmlBody);
            const updatedDate = formatUpdatedDate(template.updatedAt);
            const variables = template.variableManifest;
            const visibleVariables = variables.slice(0, 2);
            const hiddenVariableCount = variables.length - visibleVariables.length;
            const FormatIcon = getTemplateFormatIcon(template.format);

            return (
              <article key={template.id} className="template-list-item" style={{ animationDelay: `${index * 45}ms` }}>
                <div className="template-list-item__header">
                  <div className="template-list-item__copy">
                    <div className="template-list-item__title">
                      <strong>{template.name}</strong>
                      <span className="template-list-item__format">
                        <FormatIcon aria-hidden="true" />
                        {getTemplateFormatLabel(template.format)}
                      </span>
                    </div>
                    <div className="template-list-item__subject">
                      <span>Subject</span>
                      <p>{template.subject || "No subject"}</p>
                    </div>
                  </div>

                  <button
                    className="template-list-item__button"
                    type="button"
                    aria-label={`Edit template ${template.name}`}
                    onClick={() => handleStartEditing(template)}
                  >
                    <Pencil aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                </div>

                <p className="template-list-item__snippet">{cardContent.bodyPreview}</p>

                <footer className="template-list-item__meta" aria-label={`Details for ${template.name}`}>
                  {visibleVariables.length ? (
                    <span
                      className="template-list-item__variables"
                      aria-label={`${variables.length} merge ${variables.length === 1 ? "variable" : "variables"}`}
                    >
                      {visibleVariables.map((variable) => (
                        <code key={variable}>{`{{${variable}}}`}</code>
                      ))}
                      {hiddenVariableCount > 0 ? (
                        <span className="template-list-item__variables-more">+{hiddenVariableCount}</span>
                      ) : null}
                    </span>
                  ) : null}

                  <span className="template-list-item__meta-stats">
                    <span>{cardContent.wordCount} words</span>
                    <span aria-hidden="true">·</span>
                    <span>~{cardContent.readingMinutes} min read</span>
                    {updatedDate ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Updated {updatedDate}</span>
                      </>
                    ) : null}
                  </span>
                </footer>
              </article>
            );
          })}

          {!hasTemplates ? (
            <div className="templates-library__empty">
              <span className="templates-library__empty-icon">
                <FileText aria-hidden="true" />
              </span>
              <h3>Create your first template</h3>
              <p>Build a reusable message, preview it, and use it in any sequence.</p>
              <button className="button templates-library__empty-action" type="button" onClick={handleStartCreating}>
                Create new template
              </button>
            </div>
          ) : hasNoResults ? (
            <div className="saved-templates__empty" role="status">
              <span className="saved-templates__empty-icon" aria-hidden="true">
                <SearchX />
              </span>
              <strong>No matching templates</strong>
              <p>Try another name, subject, or format.</p>
              <button className="button secondary saved-templates__empty-action" type="button" onClick={() => setSearchQuery("")}>
                Clear search
              </button>
            </div>
          ) : null}
        </div>

        {filteredTemplates.length > TEMPLATE_PAGE_SIZE ? (
          <div className="templates-pagination" aria-label="Template pages">
            <p className="templates-pagination__summary">
              Showing{" "}
              <strong>
                {pageRangeStart}–{pageRangeEnd}
              </strong>{" "}
              of {filteredTemplates.length}
            </p>
            <div className="templates-pagination__controls">
              <button
                className="templates-pagination__button"
                type="button"
                aria-label="Previous template page"
                disabled={currentPage === 1}
                onClick={() => {
                  setCurrentPage((page) => Math.max(1, page - 1));
                }}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <span className="templates-pagination__page">
                {currentPage} / {totalPages}
              </span>
              <button
                className="templates-pagination__button"
                type="button"
                aria-label="Next template page"
                disabled={currentPage === totalPages}
                onClick={() => {
                  setCurrentPage((page) => Math.min(totalPages, page + 1));
                }}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
