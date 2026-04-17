export type SpamRisk = "Low" | "Medium" | "High";

export type SpamAnalysis = {
  subjectScore: number;
  subjectRisk: SpamRisk;
  subjectSignals: string[];
  bodyScore: number;
  bodyRisk: SpamRisk;
  bodySignals: string[];
};

type SpamFieldType = "subject" | "body";

type SpamFieldScore = {
  score: number;
  risk: SpamRisk;
  signals: string[];
};

type TemplateFormat = "PLAIN_TEXT" | "HTML" | "JSON";

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

function stripHtml(value: string) {
  return value
    .replace(/<a\b[^>]*>/gi, " ")
    .replace(/<\/a>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function flattenJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => flattenJson(item)).filter(Boolean).join(" ");
  }

  if (value && typeof value === "object") {
    return Object.values(value)
      .map((entry) => flattenJson(entry))
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

function normalizeBodyText(text: string, format: TemplateFormat) {
  if (format === "PLAIN_TEXT") {
    return text.replace(/\s+/g, " ").trim();
  }

  if (format === "JSON") {
    try {
      return flattenJson(JSON.parse(text))
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      return text.replace(/\s+/g, " ").trim();
    }
  }

  return stripHtml(text);
}

function getRepeatedPhraseCount(value: string) {
  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);

  const phrases = new Map<string, number>();

  for (let index = 0; index < words.length - 2; index += 1) {
    const phrase = `${words[index]} ${words[index + 1]} ${words[index + 2]}`;
    phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
  }

  let repeated = 0;
  for (const count of phrases.values()) {
    if (count > 1) {
      repeated += 1;
    }
  }

  return repeated;
}

function scoreField(fieldType: SpamFieldType, text: string): SpamFieldScore {
  const rawText = text.trim();
  if (!rawText) {
    return {
      score: 0,
      risk: "Low",
      signals: []
    };
  }

  const normalizedText = fieldType === "body" ? stripHtml(rawText) : rawText;
  const lower = normalizedText.toLowerCase();
  let score = 0;
  const signals = new Set<string>();

  const triggerWords = [
    "free",
    "guarantee",
    "limited time",
    "act now",
    "risk free",
    "winner",
    "cash",
    "urgent",
    "buy now",
    "100% guaranteed"
  ];

  const foundTriggers = triggerWords.filter((word) => lower.includes(word));
  if (foundTriggers.length) {
    score += Math.min(45, foundTriggers.length * 14);
    signals.add("Replace obvious trigger words and keep the tone calmer.");
  }

  const linkCount = countMatches(rawText, /(https?:\/\/|www\.|href=)/gi);
  if (linkCount >= 2) {
    score += linkCount >= 4 ? 22 : 12;
    signals.add("Cut down link-heavy copy and keep calls to action light.");
  }

  const exclamationCount = countMatches(normalizedText, /!/g);
  if (exclamationCount >= 3) {
    score += 12;
    signals.add("Remove stacked punctuation and let the copy stay conversational.");
  }

  const allCapsWords = normalizedText.match(/\b[A-Z]{4,}\b/g) ?? [];
  const lettersOnly = normalizedText.replace(/[^A-Za-z]/g, "");
  const uppercaseRatio = lettersOnly ? (lettersOnly.match(/[A-Z]/g)?.length ?? 0) / lettersOnly.length : 0;
  if (allCapsWords.length || uppercaseRatio > 0.34) {
    score += allCapsWords.length >= 2 || uppercaseRatio > 0.5 ? 18 : 8;
    signals.add("Tone down all-caps emphasis and keep casing natural.");
  }

  const repeatedPhraseCount = getRepeatedPhraseCount(normalizedText);
  if (repeatedPhraseCount > 0) {
    score += 12;
    signals.add("Trim repeated phrases so the message feels more human.");
  }

  const salesySignals = countMatches(
    lower,
    /\b(best deal|exclusive offer|once in a lifetime|click here|don't miss|special promotion|instant access)\b/g
  );
  if (salesySignals > 0) {
    score += 16;
    signals.add("Remove sales-heavy wording and avoid promotional phrasing.");
  }

  if (fieldType === "subject") {
    const subjectWordCount = normalizedText.split(/\s+/).filter(Boolean).length;
    if (subjectWordCount > 10) {
      score += 6;
      signals.add("Shorten the subject so it lands faster.");
    }
  } else {
    const paragraphCount = countMatches(rawText, /<p\b/gi);
    if (!paragraphCount && normalizedText.length > 420) {
      score += 6;
      signals.add("Break the body into shorter paragraphs and tighten the wording.");
    }
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  const risk: SpamRisk = normalizedScore >= 70 ? "High" : normalizedScore >= 40 ? "Medium" : "Low";

  return {
    score: normalizedScore,
    risk,
    signals: Array.from(signals)
  };
}

export async function analyzeSpam(subject: string, body: string, bodyFormat: TemplateFormat = "HTML"): Promise<SpamAnalysis> {
  await new Promise((resolve) => setTimeout(resolve, 380));

  const subjectResult = scoreField("subject", subject);
  const bodyResult = scoreField("body", normalizeBodyText(body, bodyFormat));

  return {
    subjectScore: subjectResult.score,
    subjectRisk: subjectResult.risk,
    subjectSignals: subjectResult.signals,
    bodyScore: bodyResult.score,
    bodyRisk: bodyResult.risk,
    bodySignals: bodyResult.signals
  };
}
