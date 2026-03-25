import * as React from "react";

type EmailTemplateProps = {
  firstName: string;
};

export function EmailTemplate({ firstName }: EmailTemplateProps) {
  return (
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        padding: "24px",
        color: "#1f2937"
      }}
    >
      <h1 style={{ margin: "0 0 12px", color: "#ae3f1d" }}>Welcome, {firstName}!</h1>
      <p style={{ margin: 0 }}>This is a Sendloom delivery test email.</p>
    </div>
  );
}
