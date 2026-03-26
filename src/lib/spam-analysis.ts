type SpamFieldType = "subject" | "body";

export type SpamRisk = "Low" | "Medium" | "High";

export type SpamAnalysis = {
  risk: SpamRisk;
  explanation: string;
  issues: string[];
  suggestions: string[];
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

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return value === 1 ? singular : plural;
}

export async function analyzeSpam(fieldType: SpamFieldType, text: string): Promise<SpamAnalysis> {
  await new Promise((resolve) => setTimeout(resolve, 450));

  const rawText = text.trim();
  const normalizedText = fieldType === "body" ? stripHtml(rawText) : rawText;
  const lower = normalizedText.toLowerCase();
  const issues: string[] = [];
  const suggestions: string[] = [];
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
    score += Math.min(4, foundTriggers.length * 2);
    issues.push(`Contains spam trigger ${pluralize(foundTriggers.length, "term")}: ${foundTriggers.map((word) => `"${word}"`).join(", ")}`);
    suggestions.push("Swap promotional trigger words for calmer, specific language.");
  }

  const linkCount = countMatches(rawText, /(https?:\/\/|www\.|href=)/gi);
  if (linkCount >= 2) {
    score += linkCount >= 4 ? 4 : 2;
    issues.push(`Includes ${linkCount} links, which can look promotional.`);
    suggestions.push("Keep links to the minimum needed for credibility.");
  }

  const exclamationCount = countMatches(normalizedText, /!/g);
  if (exclamationCount >= 3) {
    score += 2;
    issues.push(`Uses ${exclamationCount} exclamation marks.`);
    suggestions.push("Reduce aggressive punctuation and let the copy do the work.");
  }

  const allCapsWords = normalizedText.match(/\b[A-Z]{4,}\b/g) ?? [];
  const lettersOnly = normalizedText.replace(/[^A-Za-z]/g, "");
  const uppercaseRatio = lettersOnly ? (lettersOnly.match(/[A-Z]/g)?.length ?? 0) / lettersOnly.length : 0;
  if (allCapsWords.length || uppercaseRatio > 0.34) {
    score += allCapsWords.length >= 2 || uppercaseRatio > 0.5 ? 3 : 1;
    issues.push("Uses excessive capitalization, which can feel spammy.");
    suggestions.push("Use sentence case and reserve emphasis for one clear point.");
  }

  const repeatedPhraseCount = getRepeatedPhraseCount(normalizedText);
  if (repeatedPhraseCount > 0) {
    score += 2;
    issues.push("Repeats the same phrase pattern multiple times.");
    suggestions.push("Tighten repeated claims so the message reads more naturally.");
  }

  const salesySignals = countMatches(
    lower,
    /\b(best deal|exclusive offer|once in a lifetime|click here|don't miss|special promotion|instant access)\b/g
  );
  if (salesySignals > 0) {
    score += 2;
    issues.push("The tone reads overly promotional in places.");
    suggestions.push("Lead with relevance and context instead of pressure-heavy claims.");
  }

  if (fieldType === "subject") {
    const subjectWordCount = normalizedText.split(/\s+/).filter(Boolean).length;
    if (subjectWordCount > 10) {
      score += 1;
      issues.push("The subject is a bit long for a cold outreach line.");
      suggestions.push("Shorten the subject to one clear idea.");
    }
  } else {
    const paragraphCount = countMatches(rawText, /<p\b/gi);
    if (!paragraphCount && normalizedText.length > 420) {
      score += 1;
      issues.push("The body is dense and may feel hard to scan.");
      suggestions.push("Break the body into short paragraphs for easier reading.");
    }
  }

  const risk: SpamRisk = score >= 7 ? "High" : score >= 4 ? "Medium" : "Low";
  const explanation =
    risk === "High"
      ? "This copy has several signals that mailbox filters and readers may treat as promotional."
      : risk === "Medium"
        ? "The message is workable, but a few patterns could make delivery or trust weaker."
        : "This reads fairly safe, with only light cleanup needed before sending.";

  if (!issues.length) {
    issues.push("No major spam signals were detected.");
  }

  if (!suggestions.length) {
    suggestions.push("Keep the wording specific, restrained, and relevant to the reader.");
  }

  return {
    risk,
    explanation,
    issues: issues.slice(0, 3),
    suggestions: suggestions.slice(0, 3)
  };
}
