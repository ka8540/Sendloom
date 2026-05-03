import type { ReactNode } from "react";

import styles from "@/components/brand-text.module.css";

const BRAND_WORDS = new Set(["Sendloom", "SENDLOOM", "sendloom"]);
const BRAND_PATTERN = /(Sendloom|SENDLOOM|sendloom)/g;

function renderBrandWord(word: string, key: string) {
  return (
    <span key={key} className={styles.word}>
      {word.slice(0, -4)}
      <span className={styles.loom}>{word.slice(-4)}</span>
    </span>
  );
}

export function renderBrandText(text: string): ReactNode {
  const parts = text.split(BRAND_PATTERN);

  if (parts.length === 1) {
    return text;
  }

  return parts.map((part, index) => (BRAND_WORDS.has(part) ? renderBrandWord(part, `${part}-${index}`) : part));
}

export function BrandText({ children }: { children: string }) {
  return <>{renderBrandText(children)}</>;
}
