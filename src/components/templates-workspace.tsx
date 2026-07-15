"use client";

import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { TemplateForm, type EditableTemplate, type TemplateDraft } from "@/components/forms";
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

function normalizePreviewPayload(payload: MergeVariables | null | undefined) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))
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

function toSnippet(format: TemplateFormat, body: string) {
  const collapsed = templateContentToPlainText(format, body).replace(/\s+/g, " ").trim();

  return collapsed || "No body content yet.";
}

export function TemplatesWorkspace({ templates: initialTemplates }: { templates: EditableTemplate[] }) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates.map(normalizeTemplate));
  const [wizardOpen, setWizardOpen] = useState(false);
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
  const totalPages = Math.max(1, Math.ceil(filteredTemplates.length / TEMPLATE_PAGE_SIZE));
  const pagedTemplates = filteredTemplates.slice((currentPage - 1) * TEMPLATE_PAGE_SIZE, currentPage * TEMPLATE_PAGE_SIZE);
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
    setWizardOpen(false);
    router.replace("/templates");
    router.refresh();
  };

  const handleStartCreating = () => {
    setEditingTemplateId(null);
    setDraft(createDraft(null));
    setWizardOpen(true);
  };

  const handleStartEditing = (template: EditableTemplate) => {
    setEditingTemplateId(template.id);
    setDraft(createDraft(template));
    setHoveredTemplateId(null);
    setWizardOpen(true);
  };

  const handleCloseWizard = () => {
    setEditingTemplateId(null);
    setDraft(createDraft(null));
    setWizardOpen(false);
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
      <header className="templates-library__hero">
        <div className="templates-library__heading">
          <span className="templates-library__kicker">Message library</span>
          <h1>Templates</h1>
          <p>Create, find, and refine the messages used across your sequences.</p>
        </div>
        <button className="button templates-library__create" type="button" onClick={handleStartCreating}>
          <Plus aria-hidden="true" />
          Create new template
        </button>
      </header>

      <section className="card templates-library__card" aria-labelledby="saved-templates-heading">
        <div className="saved-templates__header">
          <div className="saved-templates__title">
            <h2 id="saved-templates-heading">Saved templates</h2>
            <span>{templates.length}</span>
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
          {pagedTemplates.map((template) => {
            const isRevealed = hoveredTemplateId === template.id;

            return (
              <article
                key={template.id}
                className={`template-list-item${isRevealed ? " is-revealed" : ""}`}
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

                  <button className="button template-list-item__button" type="button" onClick={() => handleStartEditing(template)}>
                    Edit
                  </button>
                </div>

                <div className="template-list-item__details">
                  <p className="muted">{template.subject || "No subject"}</p>
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
            <div className="templates-library__empty">
              <span className="templates-library__empty-icon">
                <Plus aria-hidden="true" />
              </span>
              <strong>Create your first template</strong>
              <p>Build a reusable message, preview it, and use it in any sequence.</p>
              <button className="button" type="button" onClick={handleStartCreating}>
                Create new template
              </button>
            </div>
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
  );
}
