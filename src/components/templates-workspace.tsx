"use client";

import { useEffect, useState } from "react";

import { TemplateForm, type EditableTemplate } from "@/components/forms";

function normalizeTemplate(template: EditableTemplate): EditableTemplate {
  return {
    ...template,
    variableManifest: Array.isArray(template.variableManifest) ? template.variableManifest : []
  };
}

export function TemplatesWorkspace({ templates: initialTemplates }: { templates: EditableTemplate[] }) {
  const [templates, setTemplates] = useState(initialTemplates.map(normalizeTemplate));
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    setTemplates(initialTemplates.map(normalizeTemplate));
  }, [initialTemplates]);

  const editingTemplate = templates.find((template) => template.id === editingTemplateId) ?? null;

  const handleSaved = (savedTemplate: EditableTemplate) => {
    const normalized = normalizeTemplate(savedTemplate);

    setTemplates((currentTemplates) => {
      const nextTemplates = currentTemplates.filter((template) => template.id !== normalized.id);
      return [normalized, ...nextTemplates];
    });
    setEditingTemplateId(null);
  };

  const heading = editingTemplate ? "Edit template" : "Create template";
  const subheading = editingTemplate
    ? "Update the saved subject and body, then save the new version."
    : "Write the subject and email body used in your sequences.";

  return (
    <div className="split">
      <section className="card">
        <h1 style={{ marginTop: 0 }}>{heading}</h1>
        <p className="muted">{subheading}</p>
        <TemplateForm
          initialTemplate={editingTemplate}
          onSaved={handleSaved}
          onCancel={() => setEditingTemplateId(null)}
        />
      </section>

      <section className="card">
        <h2>Saved templates</h2>
        <div className="stack">
          {templates.map((template) => {
            const isEditing = template.id === editingTemplateId;

            return (
              <article key={template.id} className="pre">
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "1rem",
                    flexWrap: "wrap"
                  }}
                >
                  <div style={{ minWidth: 0, flex: "1 1 18rem" }}>
                    <strong>{template.name}</strong>
                    <p className="muted" style={{ marginTop: "0.4rem", marginBottom: "0.6rem" }}>
                      {template.subject}
                    </p>
                  </div>

                  <button
                    className={`button${isEditing ? " secondary" : ""}`}
                    type="button"
                    onClick={() => setEditingTemplateId(isEditing ? null : template.id)}
                  >
                    {isEditing ? "Editing" : "Edit"}
                  </button>
                </div>

                <p
                  className="muted"
                  style={{
                    marginTop: "0.25rem",
                    marginBottom: "0.9rem",
                    whiteSpace: "pre-wrap"
                  }}
                >
                  {template.htmlBody}
                </p>
                <p className="muted">Variables: {template.variableManifest.join(", ") || "None detected"}</p>
              </article>
            );
          })}
          {!templates.length ? <div className="surface-note">Create your first template to start using it in sequences.</div> : null}
        </div>
      </section>
    </div>
  );
}
