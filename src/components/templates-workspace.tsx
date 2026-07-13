"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { TemplateForm, type EditableTemplate, type TemplateDraft } from "@/components/forms";
import {
  buildTemplatePreviewPayload,
  extractTemplateVariables,
  getDefaultTemplateBody,
  getTemplateFormatLabel,
  renderTemplatePreview,
  renderTemplateSubjectPreview,
  templateContentToPlainText,
  type TemplateFormat
} from "@/lib/templates";
import type { MergeVariables } from "@/lib/types";

const DEFAULT_TEMPLATE_DRAFT: TemplateDraft = {
  name: "",
  subject: "",
  format: "PLAIN_TEXT",
  htmlBody: getDefaultTemplateBody("PLAIN_TEXT"),
  previewPayload: null
};
const TEMPLATE_PAGE_SIZE = 5;

function normalizePreviewPayload(payload: MergeVariables | null | undefined) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(payload).filter(
      ([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value)
    )
  ) as MergeVariables;
}

function normalizeTemplate(template: EditableTemplate): EditableTemplate {
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

function extractVariables(...values: string[]) {
  const variables = new Set<string>();

  for (const value of values) {
    extractTemplateVariables(value).forEach((variable) => variables.add(variable));
  }

  return [...variables];
}

function toSnippet(format: TemplateFormat, body: string) {
  const collapsed = templateContentToPlainText(format, body)
    .replace(/\s+/g, " ")
    .trim();

  return collapsed || "No body content yet.";
}

export function TemplatesWorkspace({ templates: initialTemplates }: { templates: EditableTemplate[] }) {
  const [templates, setTemplates] = useState(initialTemplates.map(normalizeTemplate));
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [hoveredTemplateId, setHoveredTemplateId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState<TemplateDraft>(createDraft(null));
  const hoverIntentTimeoutRef = useRef<number | null>(null);
  const hoverLeaveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setTemplates(initialTemplates.map(normalizeTemplate));
  }, [initialTemplates]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredTemplates = useMemo(() => {
    if (!normalizedSearchQuery) {
      return templates;
    }

    return templates.filter((template) => {
      const haystack = [
        template.name,
        template.format,
        getTemplateFormatLabel(template.format),
        template.subject
      ]
        .join(" ")
        .toLowerCase();

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

  useEffect(() => {
    return () => {
      if (hoverIntentTimeoutRef.current) {
        window.clearTimeout(hoverIntentTimeoutRef.current);
      }

      if (hoverLeaveTimeoutRef.current) {
        window.clearTimeout(hoverLeaveTimeoutRef.current);
      }
    };
  }, []);

  const editingTemplate = templates.find((template) => template.id === editingTemplateId) ?? null;
  const previewVariables = extractVariables(draft.subject, draft.htmlBody);
  const previewPayload = buildTemplatePreviewPayload(previewVariables, draft.previewPayload ?? undefined);
  const totalPages = Math.max(1, Math.ceil(filteredTemplates.length / TEMPLATE_PAGE_SIZE));
  const pagedTemplates = filteredTemplates.slice(
    (currentPage - 1) * TEMPLATE_PAGE_SIZE,
    currentPage * TEMPLATE_PAGE_SIZE
  );
  const hasTemplates = templates.length > 0;
  const isSearching = normalizedSearchQuery.length > 0;
  const hasNoResults = isSearching && filteredTemplates.length === 0;

  const handleSaved = (savedTemplate: EditableTemplate) => {
    const normalized = normalizeTemplate(savedTemplate);

    setTemplates((currentTemplates) => {
      const nextTemplates = currentTemplates.filter((template) => template.id !== normalized.id);
      return [normalized, ...nextTemplates];
    });
    setCurrentPage(1);
    setEditingTemplateId(null);
    setDraft(createDraft(null));
  };

  const handleStartEditing = (template: EditableTemplate) => {
    const nextEditing = editingTemplateId === template.id ? null : template.id;

    setEditingTemplateId(nextEditing);
    setDraft(createDraft(nextEditing ? template : null));
  };

  const handleCancelEditing = () => {
    setEditingTemplateId(null);
    setDraft(createDraft(null));
  };

  const handleTemplateMouseEnter = (templateId: string) => {
    if (hoverIntentTimeoutRef.current) {
      window.clearTimeout(hoverIntentTimeoutRef.current);
    }

    if (hoverLeaveTimeoutRef.current) {
      window.clearTimeout(hoverLeaveTimeoutRef.current);
    }

    hoverIntentTimeoutRef.current = window.setTimeout(() => {
      setHoveredTemplateId(templateId);
    }, 340);
  };

  const handleTemplateMouseLeave = () => {
    if (hoverIntentTimeoutRef.current) {
      window.clearTimeout(hoverIntentTimeoutRef.current);
    }

    if (hoverLeaveTimeoutRef.current) {
      window.clearTimeout(hoverLeaveTimeoutRef.current);
    }

    hoverLeaveTimeoutRef.current = window.setTimeout(() => {
      setHoveredTemplateId(null);
    }, 160);
  };

  const heading = editingTemplate ? "Edit template" : "Create template";
  const subheading = editingTemplate
    ? "Update the saved subject and body, then save the new version."
    : "Write the subject and email body used in your sequences.";

  return (
    <div className="templates-layout">
      <section className="card templates-editor-card">
        <div className="templates-editor-card__header">
          <div>
            <p className="templates-editor-card__eyebrow">{editingTemplate ? "Template editor" : "Create template"}</p>
            <h1 className="dashboard-page-title">{heading}</h1>
            <p className="muted dashboard-page-subtitle">{subheading}</p>
          </div>
          <span className={`badge${editingTemplate ? "" : " warning"}`}>{editingTemplate ? "Editing" : "Draft"}</span>
        </div>
        <TemplateForm
          initialTemplate={editingTemplate}
          value={draft}
          onChange={setDraft}
          onSaved={handleSaved}
          onCancel={handleCancelEditing}
        />
      </section>

      <div className="templates-side">
        <section className="card template-preview-card">
          <div className="template-preview-card__header">
            <div>
              <h2 className="dashboard-section-title">Live preview</h2>
              <p className="muted dashboard-body" style={{ margin: 0 }}>
                What you type on the left updates here instantly.
              </p>
            </div>
            <span className="template-preview-card__hint">{getTemplateFormatLabel(draft.format)} format</span>
          </div>

          <div className="template-preview-mail">
            <div className="template-preview-mail__subject">
              <span className="template-preview-mail__label">Subject</span>
              <strong>
                {draft.subject ? renderTemplateSubjectPreview(draft.subject, previewPayload) : "Add a subject to preview it here."}
              </strong>
            </div>

            <div className="template-preview-mail__body">
              <div
                dangerouslySetInnerHTML={{
                  __html: renderTemplatePreview(draft.format, draft.htmlBody, previewPayload)
                }}
              />
            </div>
          </div>

          <div className="template-preview-variables">
            <span className="muted">Variables</span>
            <div className="pill-row">
              {previewVariables.length ? (
                previewVariables.map((variable) => (
                  <span key={variable} className="pill">
                    {variable}
                  </span>
                ))
              ) : (
                <span className="pill">None detected</span>
              )}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="saved-templates__header">
            <h2 className="dashboard-section-title">Saved templates</h2>
            {hasTemplates ? (
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
            ) : null}
          </div>
          <div className="templates-list">
          {pagedTemplates.map((template) => {
            const isEditing = template.id === editingTemplateId;
            const isRevealed = hoveredTemplateId === template.id || isEditing;

            return (
              <article
                key={template.id}
                className={`template-list-item${isEditing ? " is-active" : ""}${isRevealed ? " is-revealed" : ""}`}
                tabIndex={0}
                onMouseEnter={() => handleTemplateMouseEnter(template.id)}
                onMouseLeave={handleTemplateMouseLeave}
                onFocus={() => {
                  if (hoverIntentTimeoutRef.current) {
                    window.clearTimeout(hoverIntentTimeoutRef.current);
                  }

                  if (hoverLeaveTimeoutRef.current) {
                    window.clearTimeout(hoverLeaveTimeoutRef.current);
                  }

                  setHoveredTemplateId(template.id);
                }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    handleTemplateMouseLeave();
                  }
                }}
              >
                <div className="template-list-item__header">
                  <div className="template-list-item__copy">
                    <strong>{template.name}</strong>
                    <span className="template-list-item__format">{getTemplateFormatLabel(template.format)}</span>
                  </div>

                  <button
                    className={`button${isEditing ? " secondary" : ""} template-list-item__button`}
                    type="button"
                    onClick={() => handleStartEditing(template)}
                  >
                    {isEditing ? "Editing" : "Edit"}
                  </button>
                </div>

                <div className="template-list-item__details">
                  <p className="muted dashboard-body">{template.subject}</p>
                  <p className="template-list-item__snippet">{toSnippet(template.format, template.htmlBody)}</p>

                  <div className="pill-row">
                    {(template.variableManifest.length ? template.variableManifest : ["None detected"]).map((variable) => (
                      <span key={variable} className="pill">
                        {variable}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
            {!hasTemplates ? (
              <div className="surface-note">Create your first template to start using it in sequences.</div>
            ) : hasNoResults ? (
              <div className="surface-note saved-templates__empty">
                <strong>No templates found</strong>
                <span>Try a different search term.</span>
              </div>
            ) : null}
          </div>
          {filteredTemplates.length > TEMPLATE_PAGE_SIZE ? (
            <div className="templates-pagination" aria-label="Template pages">
              <div className="templates-pagination__controls">
                <button
                  className="templates-pagination__button"
                  type="button"
                  aria-label="Previous template page"
                  disabled={currentPage === 1}
                  onClick={() => {
                    handleTemplateMouseLeave();
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
                    handleTemplateMouseLeave();
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
    </div>
  );
}
