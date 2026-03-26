export type SpamRisk = "Low" | "Medium" | "High";

export type SpamAnalysis = {
  subjectScore: number;
  subjectRisk: SpamRisk;
  bodyScore: number;
  bodyRisk: SpamRisk;
};

type SpamFieldType = "subject" | "body";

type SpamFieldScore = {
  score: number;
  risk: SpamRisk;
};

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
      risk: "Low"
    };
  }

  const normalizedText = fieldType === "body" ? stripHtml(rawText) : rawText;
  const lower = normalizedText.toLowerCase();
  let score = 0;

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
  }

  const linkCount = countMatches(rawText, /(https?:\/\/|www\.|href=)/gi);
  if (linkCount >= 2) {
    score += linkCount >= 4 ? 22 : 12;
  }

  const exclamationCount = countMatches(normalizedText, /!/g);
  if (exclamationCount >= 3) {
    score += 12;
  }

  const allCapsWords = normalizedText.match(/\b[A-Z]{4,}\b/g) ?? [];
  const lettersOnly = normalizedText.replace(/[^A-Za-z]/g, "");
  const uppercaseRatio = lettersOnly ? (lettersOnly.match(/[A-Z]/g)?.length ?? 0) / lettersOnly.length : 0;
  if (allCapsWords.length || uppercaseRatio > 0.34) {
    score += allCapsWords.length >= 2 || uppercaseRatio > 0.5 ? 18 : 8;
  }

  const repeatedPhraseCount = getRepeatedPhraseCount(normalizedText);
  if (repeatedPhraseCount > 0) {
    score += 12;
  }

  const salesySignals = countMatches(
    lower,
    /\b(best deal|exclusive offer|once in a lifetime|click here|don't miss|special promotion|instant access)\b/g
  );
  if (salesySignals > 0) {
    score += 16;
  }

  if (fieldType === "subject") {
    const subjectWordCount = normalizedText.split(/\s+/).filter(Boolean).length;
    if (subjectWordCount > 10) {
      score += 6;
    }
  } else {
    const paragraphCount = countMatches(rawText, /<p\b/gi);
    if (!paragraphCount && normalizedText.length > 420) {
      score += 6;
    }
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  const risk: SpamRisk = normalizedScore >= 70 ? "High" : normalizedScore >= 40 ? "Medium" : "Low";

  return {
    score: normalizedScore,
    risk
  };
}

export async function analyzeSpam(subject: string, body: string): Promise<SpamAnalysis> {
  await new Promise((resolve) => setTimeout(resolve, 380));

  const subjectResult = scoreField("subject", subject);
  const bodyResult = scoreField("body", body);

  return {
    subjectScore: subjectResult.score,
    subjectRisk: subjectResult.risk,
    bodyScore: bodyResult.score,
    bodyRisk: bodyResult.risk
  };
}
