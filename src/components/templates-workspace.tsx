"use client";

import { useEffect, useState } from "react";

import { TemplateForm, type EditableTemplate, type TemplateDraft } from "@/components/forms";

const DEFAULT_TEMPLATE_DRAFT: TemplateDraft = {
  name: "",
  subject: "",
  htmlBody: `<p>Hi {{name}},</p>\n<p>I noticed {{company}} and wanted to reach out.</p>`
};

function normalizeTemplate(template: EditableTemplate): EditableTemplate {
  return {
    ...template,
    variableManifest: Array.isArray(template.variableManifest) ? template.variableManifest : []
  };
}

function createDraft(template?: EditableTemplate | null): TemplateDraft {
  return {
    name: template?.name ?? DEFAULT_TEMPLATE_DRAFT.name,
    subject: template?.subject ?? DEFAULT_TEMPLATE_DRAFT.subject,
    htmlBody: template?.htmlBody ?? DEFAULT_TEMPLATE_DRAFT.htmlBody
  };
}

function extractVariables(...values: string[]) {
  const variablePattern = /{{\s*([^}]+?)\s*}}/g;
  const variables = new Set<string>();

  for (const value of values) {
    for (const match of value.matchAll(variablePattern)) {
      const variable = match[1]?.trim();

      if (variable) {
        variables.add(variable);
      }
    }
  }

  return [...variables];
}

function toSnippet(htmlBody: string) {
  const collapsed = htmlBody
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return collapsed || "No body content yet.";
}

export function TemplatesWorkspace({ templates: initialTemplates }: { templates: EditableTemplate[] }) {
  const [templates, setTemplates] = useState(initialTemplates.map(normalizeTemplate));
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>(createDraft(null));

  useEffect(() => {
    setTemplates(initialTemplates.map(normalizeTemplate));
  }, [initialTemplates]);

  const editingTemplate = templates.find((template) => template.id === editingTemplateId) ?? null;
  const previewVariables = extractVariables(draft.subject, draft.htmlBody);

  const handleSaved = (savedTemplate: EditableTemplate) => {
    const normalized = normalizeTemplate(savedTemplate);

    setTemplates((currentTemplates) => {
      const nextTemplates = currentTemplates.filter((template) => template.id !== normalized.id);
      return [normalized, ...nextTemplates];
    });
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

  const heading = editingTemplate ? "Edit template" : "Create template";
  const subheading = editingTemplate
    ? "Update the saved subject and body, then save the new version."
    : "Write the subject and email body used in your sequences.";

  return (
    <div className="templates-layout">
      <section className="card templates-editor-card">
        <h1 style={{ marginTop: 0 }}>{heading}</h1>
        <p className="muted">{subheading}</p>
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
              <h2 style={{ marginTop: 0, marginBottom: "0.45rem" }}>Live preview</h2>
              <p className="muted" style={{ margin: 0 }}>
                What you type on the left updates here instantly.
              </p>
            </div>
            <span className="badge">{editingTemplate ? "Editing" : "Draft"}</span>
          </div>

          <div className="template-preview-subject">
            <span className="muted">Subject</span>
            <strong>{draft.subject || "Add a subject to preview it here."}</strong>
          </div>

          <div className="template-preview-body">
            <div dangerouslySetInnerHTML={{ __html: draft.htmlBody || "<p>Add body content to preview it here.</p>" }} />
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
          <h2 style={{ marginTop: 0 }}>Saved templates</h2>
          <div className="templates-list">
          {templates.map((template) => {
            const isEditing = template.id === editingTemplateId;

            return (
              <article key={template.id} className={`template-list-item${isEditing ? " is-active" : ""}`}>
                <div className="template-list-item__header">
                  <div className="template-list-item__copy">
                    <strong>{template.name}</strong>
                    <p className="muted">{template.subject}</p>
                  </div>

                  <button
                    className={`button${isEditing ? " secondary" : ""} template-list-item__button`}
                    type="button"
                    onClick={() => handleStartEditing(template)}
                  >
                    {isEditing ? "Editing" : "Edit"}
                  </button>
                </div>

                <p className="template-list-item__snippet">{toSnippet(template.htmlBody)}</p>

                <div className="pill-row">
                  {(template.variableManifest.length ? template.variableManifest : ["None detected"]).map((variable) => (
                    <span key={variable} className="pill">
                      {variable}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
            {!templates.length ? <div className="surface-note">Create your first template to start using it in sequences.</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
