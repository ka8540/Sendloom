import { TemplateForm } from "@/components/forms";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function TemplatesPage() {
  const user = await requireUser();
  const templates = await prisma.template.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" }
  });

  return (
    <div className="split">
      <section className="card">
        <h1 style={{ marginTop: 0 }}>Create template</h1>
        <p className="muted">Write the subject and email body used in your sequences.</p>
        <TemplateForm />
      </section>

      <section className="card">
        <h2>Saved templates</h2>
        <div className="stack">
          {templates.map((template) => (
            <article key={template.id} className="pre">
              <strong>{template.name}</strong>
              <p className="muted" style={{ marginTop: "0.4rem" }}>
                {template.subject}
              </p>
              <p className="muted">Variables: {(template.variableManifest as string[]).join(", ") || "None detected"}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
