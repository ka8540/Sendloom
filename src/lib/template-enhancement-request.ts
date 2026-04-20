import { z } from "zod";

import { TEMPLATE_FORMATS } from "@/lib/templates";

export const spamAnalysisSchema = z.object({
  subjectScore: z.number().min(0).max(100),
  subjectRisk: z.enum(["Low", "Medium", "High"]),
  subjectSignals: z.array(z.string()).default([]),
  bodyScore: z.number().min(0).max(100),
  bodyRisk: z.enum(["Low", "Medium", "High"]),
  bodySignals: z.array(z.string()).default([])
});

export const enhanceTemplateRequestSchema = z
  .object({
    action: z.enum(["enhance", "fix-spam"]).optional(),
    fieldType: z.enum(["subject", "body"]).optional(),
    templateFormat: z.enum(TEMPLATE_FORMATS).optional(),
    currentText: z.string().optional().default(""),
    templateName: z.string().trim().optional(),
    subjectContext: z.string().optional(),
    bodyContext: z.string().optional(),
    spamAnalysis: spamAnalysisSchema.nullish().transform((value) => value ?? undefined)
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

export type SpamAnalysisPayload = z.infer<typeof spamAnalysisSchema>;
export type EnhanceTemplateRequest = z.infer<typeof enhanceTemplateRequestSchema>;
