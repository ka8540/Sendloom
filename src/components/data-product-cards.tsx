"use client";

import { useState, type CSSProperties } from "react";
import { Check } from "lucide-react";

import { SendloomLogo } from "@/components/sendloom-logo";
import styles from "@/app/landing.module.css";

const delay = (seconds: number) => ({ "--d": `${seconds * 0.7}s` }) as CSSProperties;

const cardLabels = ["Imports", "Discover", "Add to outreach"] as const;

export function DataProductCards() {
  const [selected, setSelected] = useState<number | null>(null);
  const [activation, setActivation] = useState(0);

  const selectCard = (index: number) => {
    setSelected(index);
    setActivation((value) => value + 1);
  };

  const dataVisuals = [
    <article key="imports" className={styles.dataCard} aria-label="Imports: mapping a CSV to contact fields">
      <div className={styles.winBar}>
        <SendloomLogo className={styles.winMark} />
        <span className={styles.winTitle}>Imports</span>
        <span className={styles.winMeta}>your_list.csv</span>
      </div>
      <div className={styles.winBody}>
        <div className={`${styles.winIntro} ${styles.rv}`} style={delay(0.05)}>
          <div>
            <p className={styles.winScreenTitle}>Map fields</p>
            <p className={styles.winSub}>Match your file columns to Sendloom.</p>
          </div>
          <span className={styles.winCount}>228 contacts</span>
        </div>
        <div className={`${styles.winHead} ${styles.rv}`} style={delay(0.14)}>
          <span>CSV column</span>
          <span>Sendloom field</span>
          <span aria-hidden="true" />
        </div>
        {[
          ["first_name", "First Name"],
          ["last_name", "Last Name"],
          ["email", "Email"],
          ["company", "Company"]
        ].map(([column, field], row) => (
          <div key={column} className={`${styles.winRow} ${styles.rv}`} style={delay(0.2 + row * 0.06)}>
            <span className={styles.srcField}>{column}</span>
            <span className={styles.fieldControl}>
              {field}
              <i className={styles.chev} aria-hidden="true" />
            </span>
            <span className={styles.rowStatus}>
              <Check aria-hidden="true" />
            </span>
          </div>
        ))}
      </div>
      <div className={styles.winFoot}>
        <span className={styles.footOk}>
          <Check aria-hidden="true" />
          4 of 4 mapped
        </span>
        <span className={styles.chipReady}>Ready</span>
      </div>
    </article>,

    <article key="discover" className={styles.dataCard} aria-label="Discover: searching contacts by company, role, and location">
      <div className={styles.winBar}>
        <SendloomLogo className={styles.winMark} />
        <span className={styles.winTitle}>Discover</span>
        <span className={styles.winMeta}>12 results</span>
      </div>
      <div className={styles.winBody}>
        <div className={`${styles.filterRow} ${styles.rv}`} style={delay(0.05)}>
          {[
            ["Company", "Stripe"],
            ["Role", "Software Engineer"],
            ["Location", "San Francisco"]
          ].map(([label, value]) => (
            <span key={label} className={styles.filterField}>
              <span className={styles.filterLabel}>{label}</span>
              {value}
            </span>
          ))}
        </div>
        <div className={`${styles.winHead} ${styles.headPeople} ${styles.rv}`} style={delay(0.14)}>
          <span aria-hidden="true" />
          <span>Person</span>
          <span>Role</span>
          <span className={styles.colCompany}>Company</span>
          <span className={styles.colLocation}>Location</span>
        </div>
        {[
          ["Maya Chen", "Software Engineer", "Stripe", "San Francisco", true],
          ["Ethan Miller", "Backend Engineer", "Stripe", "New York", false],
          ["Priya Shah", "Platform Engineer", "Stripe", "Seattle", false]
        ].map(([name, role, company, location, selected], row) => (
          <div
            key={name as string}
            className={
              selected
                ? `${styles.winRow} ${styles.rowPeople} ${styles.winRowSelected} ${styles.rv}`
                : `${styles.winRow} ${styles.rowPeople} ${styles.rv}`
            }
            style={delay(0.2 + row * 0.07)}
          >
            <span className={styles.selBox} aria-hidden="true">
              {selected ? <Check /> : null}
            </span>
            <span className={styles.personName}>{name}</span>
            <span className={styles.cellMuted}>{role}</span>
            <span className={`${styles.cellMuted} ${styles.colCompany}`}>{company}</span>
            <span className={`${styles.cellMuted} ${styles.colLocation}`}>{location}</span>
          </div>
        ))}
      </div>
      <div className={`${styles.winFoot} ${styles.rv}`} style={delay(0.5)}>
        <span>1 selected</span>
        <span className={styles.footAction}>Add selected to import</span>
      </div>
    </article>,

    <article key="outreach-list" className={styles.dataCard} aria-label="Discover: reviewing people for an outreach list">
      <div className={styles.winBar}>
        <SendloomLogo className={styles.winMark} />
        <span className={styles.winTitle}>Add to outreach</span>
        <span className={styles.winMeta}>From Discover</span>
      </div>
      <div className={styles.winBody}>
        <div className={`${styles.winIntro} ${styles.rv}`} style={delay(0.05)}>
          <div>
            <p className={styles.winScreenTitle}>Review contacts</p>
            <p className={styles.winSub}>Choose who belongs on your list.</p>
          </div>
          <span className={styles.winCount}>3 contacts</span>
        </div>
        <div className={`${styles.enrichProgress} ${styles.rv}`} style={delay(0.12)}>
          <span className={styles.enrichTrack} aria-hidden="true">
            <span className={styles.enrichFill} />
          </span>
          <span>2 of 3 selected</span>
        </div>
        <div className={`${styles.enrichRow} ${styles.rv}`} style={delay(0.2)}>
          <span className={styles.avatar} aria-hidden="true">MC</span>
          <span className={styles.enrichWho}>
            <span className={styles.personName}>Maya Chen</span>
            <span className={styles.cellMuted}>Stripe</span>
          </span>
          <span className={styles.mailField}>maya@stripe.com</span>
          <span className={`${styles.statusChip} ${styles.statusFound}`}>Selected</span>
        </div>
        <div className={`${styles.enrichRow} ${styles.rv}`} style={delay(0.27)}>
          <span className={styles.avatar} aria-hidden="true">EM</span>
          <span className={styles.enrichWho}>
            <span className={styles.personName}>Ethan Miller</span>
            <span className={styles.cellMuted}>Linear</span>
          </span>
          <span className={styles.swapCell}>
            <span className={`${styles.mailField} ${styles.mailFieldEmpty} ${styles.swapPending}`}>
              <i className={styles.searchDot} aria-hidden="true" />
              Reviewing
            </span>
            <span className={`${styles.mailField} ${styles.swapFound}`}>ethan@linear.com</span>
          </span>
          <span className={`${styles.swapCell} ${styles.swapStatus}`}>
            <span className={`${styles.statusChip} ${styles.statusSearching} ${styles.swapPending}`}>Review</span>
            <span className={`${styles.statusChip} ${styles.statusFound} ${styles.swapFound}`}>Selected</span>
          </span>
        </div>
        <div className={`${styles.enrichRow} ${styles.rv}`} style={delay(0.34)}>
          <span className={styles.avatar} aria-hidden="true">PS</span>
          <span className={styles.enrichWho}>
            <span className={styles.personName}>Priya Shah</span>
            <span className={styles.cellMuted}>Figma</span>
          </span>
          <span className={styles.mailField}>priya@figma.com</span>
          <span className={`${styles.statusChip} ${styles.statusSearching}`}>Review</span>
        </div>
      </div>
      <div className={`${styles.winFoot} ${styles.rv}`} style={delay(0.5)}>
        <span>Review inferred work contacts</span>
        <span className={styles.chipReady}>Add selected</span>
      </div>
    </article>
  ];

  return (
    <div className={styles.productDeck} aria-label="Imports, Discover, and Add to outreach previews">
      {dataVisuals.map((visual, index) => (
        <div
          key={cardLabels[index]}
          className={styles.productDeckItem}
          data-product-card={cardLabels[index]}
          data-selected={selected === index ? "" : undefined}
          role="button"
          tabIndex={0}
          aria-label={`Select ${cardLabels[index]} preview`}
          aria-pressed={selected === index}
          onClick={() => selectCard(index)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectCard(index);
            }
          }}
        >
          <div className={styles.productDeckInner} key={selected === index ? activation : 0}>
            {visual}
          </div>
        </div>
      ))}
    </div>
  );
}
