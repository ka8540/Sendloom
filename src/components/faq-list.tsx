"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import styles from "@/app/faq/page.module.css";

type FaqItem = {
  answer: string;
  question: string;
};

type FaqSection = {
  id: string;
  items: readonly FaqItem[];
  title: string;
};

export function FaqList({ sections }: { sections: readonly FaqSection[] }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(() => new Set());

  const togglePinnedId = (id: string) => {
    setPinnedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  return (
    <div className={styles.faqSections}>
      {sections.map((section) => (
        <section key={section.id} id={section.id} className={styles.faqSection}>
          <h3>{section.title}</h3>

          <div className={styles.faqCards}>
            {section.items.map((item, index) => {
              const id = `${section.id}-${index + 1}`;
              const answerId = `${id}-answer`;
              const isVisible = hoveredId === id || focusedId === id || pinnedIds.has(id);

              return (
                <article
                  key={item.question}
                  className={`${styles.faqCard}${isVisible ? ` ${styles.faqCardVisible}` : ""}`}
                  onMouseEnter={() => setHoveredId(id)}
                  onMouseLeave={() => {
                    setHoveredId((current) => (current === id ? null : current));
                  }}
                  onFocusCapture={() => setFocusedId(id)}
                  onBlurCapture={(event) => {
                    const nextTarget = event.relatedTarget;

                    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                      setFocusedId((current) => (current === id ? null : current));
                    }
                  }}
                >
                  <h4 className={styles.faqHeading}>
                    <button
                      aria-controls={answerId}
                      aria-expanded={isVisible}
                      className={styles.faqQuestion}
                      type="button"
                      onClick={() => togglePinnedId(id)}
                    >
                      <span>{item.question}</span>
                      <ChevronDown aria-hidden="true" />
                    </button>
                  </h4>

                  <div id={answerId} aria-hidden={!isVisible} className={styles.faqAnswerWrap}>
                    <div className={styles.faqAnswerInner}>
                      <p className={styles.faqAnswer}>{item.answer}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
