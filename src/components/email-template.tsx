type EmailTemplateProps = {
  firstName: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderEmailTemplate({ firstName }: EmailTemplateProps) {
  const safeFirstName = escapeHtml(firstName);

  return `
    <div style="font-family: Arial, sans-serif; padding: 24px; color: #1f2937;">
      <h1 style="margin: 0 0 12px; color: #ae3f1d;">Welcome, ${safeFirstName}!</h1>
      <p style="margin: 0;">This is a Send<span style="color: #23a774;">loom</span> delivery test email.</p>
    </div>
  `.trim();
}
