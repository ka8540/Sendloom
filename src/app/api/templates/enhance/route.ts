import { NextResponse } from "next/server";
import { z } from "zod";

import { createUnauthorizedApiResponse } from "@/lib/api-auth";
import { getSessionUser } from "@/lib/auth";
import { env } from "@/lib/env";

const requestSchema = z.object({
  fieldType: z.enum(["subject", "body"]),
  currentText: z.string().trim().min(1)
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

function getInstructions(fieldType: "subject" | "body") {
  if (fieldType === "subject") {
    return [
      "You rewrite outreach email subjects.",
      "Improve the line to sound professional, clear, and personal.",
      "Avoid generic sales phrases and hype.",
      "Preserve any merge variables exactly, including {{name}} and {{company}}.",
      "Return only the rewritten subject line with no quotes, bullets, or explanation."
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

function normalizeEnhancedText(fieldType: "subject" | "body", text: string) {
  const cleaned = text.trim().replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!cleaned) {
    return "";
  }

  if (fieldType === "subject") {
    return cleaned.replace(/\s+/g, " ");
  }

  return cleaned;
}

async function enhanceText(fieldType: "subject" | "body", currentText: string) {
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
      instructions: getInstructions(fieldType),
      input: `Rewrite this ${fieldType === "subject" ? "email subject" : "HTML email body"}:\n\n${currentText}`,
      max_output_tokens: fieldType === "subject" ? 120 : 900
    })
  });

  const payload = (await response.json()) as OpenAIResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "AI enhancement failed.");
  }

  const enhancedText = normalizeEnhancedText(fieldType, extractOutputText(payload));
  if (!enhancedText) {
    throw new Error("AI enhancement returned an empty result.");
  }

  return enhancedText;
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return createUnauthorizedApiResponse();
    }

    const payload = requestSchema.parse(await request.json());
    const enhancedText = await enhanceText(payload.fieldType, payload.currentText);

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
