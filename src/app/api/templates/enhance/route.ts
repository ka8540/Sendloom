import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { sanitizeDatabaseError } from "@/lib/db-error";
import { env } from "@/lib/env";
import { createRateLimitResponse, rateLimit } from "@/lib/rate-limit";
import { enhanceTemplateRequestSchema, type SpamAnalysisPayload } from "@/lib/template-enhancement-request";
import { getDefaultTemplateBody, TEMPLATE_FORMATS, type TemplateFormat, validateTemplateBody } from "@/lib/templates";

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

function getFormatLabel(templateFormat: TemplateFormat) {
  if (templateFormat === "PLAIN_TEXT") {
    return "plain text";
  }

  if (templateFormat === "JSON") {
    return "structured JSON";
  }

  return "HTML";
}

function getInstructions(fieldType: "subject" | "body", templateFormat: TemplateFormat = "HTML") {
  if (fieldType === "subject") {
    return [
      "You are a senior cold email copywriter and deliverability editor.",
      "If a subject already exists, rewrite it. If it is empty, draft a new subject from the available context.",
      "Sound human, calm, and specific instead of promotional.",
      "Avoid hype, urgency, stacked punctuation, all caps, and generic sales phrases.",
      "Preserve existing merge variables exactly. If you are drafting from scratch, you may introduce one natural merge variable when it helps.",
      "Keep the subject concise and easy to read.",
      "Return only the final subject line with no quotes, bullets, or explanation."
    ].join(" ");
  }

  if (templateFormat === "PLAIN_TEXT") {
    return [
      "You are a senior cold email copywriter and deliverability editor.",
      "If body copy already exists, rewrite it. If it is empty, draft a new cold outreach email from the available context.",
      "Keep the message concise, natural, and genuinely personal.",
      "Avoid generic phrases, fluff, robotic wording, hype, urgency, and spam triggers.",
      "Preserve existing merge variables exactly. If you are drafting from scratch, you may naturally use {{name}} and {{company}} when useful.",
      "Use short paragraphs and one calm CTA.",
      "Keep the response as plain text only.",
      "Preserve paragraph breaks and do not return HTML or markdown."
    ].join(" ");
  }

  if (templateFormat === "JSON") {
    return [
      "You are a senior cold email copywriter and deliverability editor.",
      "If JSON body content already exists, rewrite it. If it is empty, draft a new structured cold outreach email from the available context.",
      "Keep the message concise, natural, and genuinely personal.",
      "Avoid generic phrases, fluff, robotic wording, hype, urgency, and spam triggers.",
      "Preserve existing merge variables exactly. If you are drafting from scratch, you may naturally use {{name}} and {{company}} when useful.",
      "Preserve the current JSON structure and keys when source JSON is provided.",
      "When drafting from scratch, use the supplied JSON scaffold shape if one is given.",
      "Return valid JSON only with no markdown or explanation."
    ].join(" ");
  }

  return [
    "You are a senior cold email copywriter and deliverability editor.",
    "If HTML body content already exists, rewrite it. If it is empty, draft a new cold outreach email from the available context.",
    "Keep the message concise, natural, and genuinely personal.",
    "Avoid generic phrases, fluff, robotic wording, hype, urgency, and spam triggers.",
    "Preserve existing merge variables exactly. If you are drafting from scratch, you may naturally use {{name}} and {{company}} when useful.",
    "Use short paragraphs and one calm CTA.",
    "Keep the response as valid HTML fragment only.",
    "Do not wrap it in markdown, code fences, or <html>/<body> tags.",
    "Return only the final HTML."
  ].join(" ");
}

function extractOutputText(response: OpenAIResponse) {
  const direct = response.output_text?.trim();
  if (direct) {
    return direct;
  }

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      const text = content.text?.trim();
      if (text) {
        return text;
      }
    }
  }

  return "";
}

function normalizeEnhancedText(
  fieldType: "subject" | "body",
  text: string,
  templateFormat: TemplateFormat = "HTML"
) {
  const cleaned = text.trim().replace(/^```(?:html|json|txt|text)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!cleaned) {
    return "";
  }

  if (fieldType === "subject") {
    return cleaned.replace(/\s+/g, " ");
  }

  if (templateFormat === "PLAIN_TEXT") {
    return cleaned.replace(/\r\n/g, "\n");
  }

  return cleaned;
}

function formatSpamContext(fieldType: "subject" | "body", spamAnalysis?: SpamAnalysisPayload) {
  if (!spamAnalysis) {
    return "";
  }

  const score = fieldType === "subject" ? spamAnalysis.subjectScore : spamAnalysis.bodyScore;
  const risk = fieldType === "subject" ? spamAnalysis.subjectRisk : spamAnalysis.bodyRisk;
  const signals = fieldType === "subject" ? spamAnalysis.subjectSignals : spamAnalysis.bodySignals;

  if (!signals.length && score < 1) {
    return "";
  }

  return [
    `Latest spam check for this ${fieldType}: ${risk} risk (${score}/100).`,
    signals.length ? `Use this guidance while writing:\n- ${signals.join("\n- ")}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPrompt(options: {
  fieldType: "subject" | "body";
  templateFormat: TemplateFormat;
  currentText: string;
  templateName?: string;
  subjectContext?: string;
  bodyContext?: string;
  spamAnalysis?: SpamAnalysisPayload;
}) {
  const { bodyContext, currentText, fieldType, spamAnalysis, subjectContext, templateFormat, templateName } = options;
  const trimmedCurrentText = currentText.trim();
  const trimmedTemplateName = templateName?.trim();
  const trimmedSubjectContext = subjectContext?.trim();
  const trimmedBodyContext = bodyContext?.trim();
  const spamContext = formatSpamContext(fieldType, spamAnalysis);
  const bodyFormatLabel = getFormatLabel(templateFormat);

  return [
    trimmedCurrentText
      ? `Task: Rewrite the existing ${fieldType === "subject" ? "subject line" : `${bodyFormatLabel} email body`}.`
      : `Task: Draft a new ${fieldType === "subject" ? "subject line" : `${bodyFormatLabel} email body`} from the available context.`,
    trimmedTemplateName ? `Template name:\n${trimmedTemplateName}` : "Template name: not provided.",
    trimmedSubjectContext ? `Current subject context:\n${trimmedSubjectContext}` : "",
    trimmedBodyContext ? `Current body context:\n${trimmedBodyContext}` : "",
    trimmedCurrentText
      ? `Current ${fieldType === "subject" ? "subject line" : `${bodyFormatLabel} body`}:\n${trimmedCurrentText}`
      : "",
    !trimmedCurrentText && fieldType === "body" && templateFormat === "JSON"
      ? `Use this JSON scaffold shape when drafting:\n${getDefaultTemplateBody("JSON")}`
      : "",
    spamContext,
    "If the context is sparse, draft a clean first-touch cold email that feels personal, restrained, and usable in a real workflow.",
    fieldType === "subject"
      ? "Keep the subject under about eight words when possible."
      : "Aim for two to four short paragraphs and one calm CTA.",
    fieldType === "subject"
      ? "Output requirement: return the subject line only."
      : templateFormat === "JSON"
        ? "Output requirement: return valid JSON only."
        : templateFormat === "PLAIN_TEXT"
          ? "Output requirement: return plain text only."
          : "Output requirement: return an HTML fragment only."
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function requestEnhancedText(options: {
  fieldType: "subject" | "body";
  templateFormat: TemplateFormat;
  currentText: string;
  templateName?: string;
  subjectContext?: string;
  bodyContext?: string;
  spamAnalysis?: SpamAnalysisPayload;
}) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("Add OPENAI_API_KEY to your environment before using AI enhancement.");
  }

  const { fieldType, templateFormat } = options;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      reasoning: {
        effort: "minimal"
      },
      instructions: getInstructions(fieldType, templateFormat),
      input: buildPrompt(options),
      max_output_tokens: fieldType === "subject" ? 120 : 900
    })
  });

  const payload = (await response.json()) as OpenAIResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "AI enhancement failed.");
  }

  const enhancedText = normalizeEnhancedText(fieldType, extractOutputText(payload), templateFormat);
  if (!enhancedText) {
    throw new Error("AI enhancement returned an empty result.");
  }

  if (fieldType === "body") {
    const validationError = validateTemplateBody(templateFormat, enhancedText);
    if (validationError) {
      throw new Error(validationError);
    }
  }

  return enhancedText;
}

export async function POST(request: Request) {
  try {
    const auth = await requireApiUser("aiEnhance");
    if ("response" in auth) {
      return auth.response;
    }

    const limit = await rateLimit({ key: `templates:enhance:user:${auth.user.id}`, limit: 20, windowSeconds: 60 });
    if (!limit.allowed) {
      return createRateLimitResponse(limit.retryAfterSeconds);
    }

    const payload = enhanceTemplateRequestSchema.parse(await request.json());
    const action = payload.action ?? "enhance";
    const templateFormat = payload.templateFormat ?? "HTML";
    const fieldType = action === "fix-spam" ? (payload.fieldType ?? "body") : payload.fieldType!;
    const enhancedText = await requestEnhancedText({
      fieldType,
      templateFormat,
      currentText: payload.currentText,
      templateName: payload.templateName,
      subjectContext: payload.subjectContext,
      bodyContext: payload.bodyContext,
      spamAnalysis: payload.spamAnalysis
    });

    await recordAuditEvent({
      actor: { id: auth.user.id, email: auth.user.email },
      action: action === "fix-spam" ? "template.spam_fix_applied" : "template.ai_enhanced",
      category: "TEMPLATE",
      target: payload.templateName ? { type: "template", name: payload.templateName } : null,
      message:
        action === "fix-spam"
          ? "Used AI to rework spam-flagged template copy."
          : `Used AI enhancement on the template ${fieldType}.`,
      metadata: { fieldType, templateFormat },
      request
    });

    return NextResponse.json({
      enhancedText
    });
  } catch (error) {
    const dbMessage = sanitizeDatabaseError(error, { operation: "POST /api/templates/enhance" });
    const message = dbMessage ?? (error instanceof Error ? error.message : "AI enhancement failed.");
    return NextResponse.json(
      {
        error: message
      },
      { status: 400 }
    );
  }
}
