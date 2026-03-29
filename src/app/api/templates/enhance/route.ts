import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/api-auth";
import { env } from "@/lib/env";
import { TEMPLATE_FORMATS, type TemplateFormat, validateTemplateBody } from "@/lib/templates";

const requestSchema = z
  .object({
    action: z.enum(["enhance", "fix-spam"]).optional(),
    fieldType: z.enum(["subject", "body"]).optional(),
    templateFormat: z.enum(TEMPLATE_FORMATS).optional(),
    currentText: z.string().trim().min(1)
  })
  .superRefine((value, ctx) => {
    const action = value.action ?? "enhance";
    if (action === "enhance" && !value.fieldType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fieldType"],
        message: "fieldType is required for AI enhancement."
      });
    }
  });

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

function getInstructions(fieldType: "subject" | "body", templateFormat: TemplateFormat = "HTML") {
  if (fieldType === "subject") {
    return [
      "You rewrite outreach email subjects.",
      "Improve the line to sound professional, clear, and personal.",
      "Avoid generic sales phrases and hype.",
      "Preserve any merge variables exactly, including {{name}} and {{company}}.",
      "Return only the rewritten subject line with no quotes, bullets, or explanation."
    ].join(" ");
  }

  if (templateFormat === "PLAIN_TEXT") {
    return [
      "You rewrite plain text email body copy for cold outreach.",
      "Improve the copy for professionalism, clarity, and personalization.",
      "Avoid generic phrases, fluff, and robotic wording.",
      "Preserve merge variables exactly, including {{name}} and {{company}}.",
      "Keep the response as plain text only.",
      "Preserve paragraph breaks and do not return HTML or markdown."
    ].join(" ");
  }

  if (templateFormat === "JSON") {
    return [
      "You rewrite structured JSON used to generate an outreach email body.",
      "Improve the copy for professionalism, clarity, and personalization.",
      "Avoid generic phrases, fluff, and robotic wording.",
      "Preserve merge variables exactly, including {{name}} and {{company}}.",
      "Preserve the JSON structure and keys already present.",
      "Return valid JSON only with no markdown or explanation."
    ].join(" ");
  }

  return [
    "You rewrite HTML email body fragments for cold outreach.",
    "Improve the copy for professionalism, clarity, and personalization.",
    "Avoid generic phrases, fluff, and robotic wording.",
    "Preserve merge variables exactly, including {{name}} and {{company}}.",
    "Keep the response as valid HTML fragment only.",
    "Do not wrap it in markdown, code fences, or <html>/<body> tags.",
    "Return only the rewritten HTML."
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

async function enhanceText(fieldType: "subject" | "body", currentText: string, templateFormat: TemplateFormat = "HTML") {
  if (!env.OPENAI_API_KEY) {
    throw new Error("Add OPENAI_API_KEY to your environment before using AI enhancement.");
  }

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
      input: `Rewrite this ${
        fieldType === "subject"
          ? "email subject"
          : templateFormat === "PLAIN_TEXT"
            ? "plain text email body"
            : templateFormat === "JSON"
              ? "JSON email body"
              : "HTML email body"
      }:\n\n${currentText}`,
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

async function fixSpamContent(currentText: string, templateFormat: TemplateFormat = "HTML") {
  if (!env.OPENAI_API_KEY) {
    throw new Error("Add OPENAI_API_KEY to your environment before using AI enhancement.");
  }

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
      instructions:
        templateFormat === "PLAIN_TEXT"
          ? [
              "You are an expert in email deliverability.",
              "Rewrite the following plain text email to reduce spam risk while keeping the original intent.",
              "Remove or replace spam trigger words.",
              "Reduce aggressive or overly promotional tone.",
              "Keep it natural, professional, and concise.",
              "Keep the message under 150 words.",
              "Preserve merge variables exactly, including {{name}} and {{company}}.",
              "Return only the improved plain text."
            ].join(" ")
          : templateFormat === "JSON"
            ? [
                "You are an expert in email deliverability.",
                "Rewrite the following JSON email body to reduce spam risk while keeping the original intent.",
                "Remove or replace spam trigger words.",
                "Reduce aggressive or overly promotional tone.",
                "Keep it natural, professional, and concise.",
                "Keep the message under 150 words in total.",
                "Preserve merge variables exactly, including {{name}} and {{company}}.",
                "Preserve the JSON keys and return valid JSON only."
              ].join(" ")
            : [
                "You are an expert in email deliverability.",
                "Rewrite the following HTML email body to reduce spam risk while keeping the original intent.",
                "Remove or replace spam trigger words.",
                "Reduce aggressive or overly promotional tone.",
                "Keep it natural, professional, and concise.",
                "Keep the message under 150 words.",
                "Preserve merge variables exactly, including {{name}} and {{company}}.",
                "Return only the improved HTML fragment.",
                "Do not wrap the result in markdown, code fences, or <html>/<body> tags."
              ].join(" "),
      input: `Email:\n${currentText}`,
      max_output_tokens: 900
    })
  });

  const payload = (await response.json()) as OpenAIResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "AI spam fix failed.");
  }

  const enhancedText = normalizeEnhancedText("body", extractOutputText(payload), templateFormat);
  if (!enhancedText) {
    throw new Error("AI spam fix returned an empty result.");
  }

  const validationError = validateTemplateBody(templateFormat, enhancedText);
  if (validationError) {
    throw new Error(validationError);
  }

  return enhancedText;
}

export async function POST(request: Request) {
  try {
    const auth = await requireApiUser("aiEnhance");
    if ("response" in auth) {
      return auth.response;
    }

    const payload = requestSchema.parse(await request.json());
    const action = payload.action ?? "enhance";
    const templateFormat = payload.templateFormat ?? "HTML";
    const enhancedText =
      action === "fix-spam"
        ? await fixSpamContent(payload.currentText, templateFormat)
        : await enhanceText(payload.fieldType!, payload.currentText, templateFormat);

    return NextResponse.json({
      enhancedText
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI enhancement failed.";
    return NextResponse.json(
      {
        error: message
      },
      { status: 400 }
    );
  }
}
