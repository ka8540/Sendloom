import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, CheckCircle2, Gauge, ShieldAlert, type LucideIcon } from "lucide-react";

import { formatCompactNumber } from "@/components/dashboard/formatters";
import type { ActionItem, FailureCategory, OverviewAttention } from "@/components/dashboard/analytics-types";
import styles from "./needs-attention-panel.module.css";

/**
 * Compact, operator-focused "Needs attention" section for the Overview page.
 * Surfaces the two signals that aren't already shown elsewhere on the page:
 * what to act on right now, and whether delivery failures are retryable or
 * action-required. Pure server component — no charts, no client fetching.
 */
export function NeedsAttentionPanel({ data }: { data: OverviewAttention }) {
  const { actions, failures } = data;
  const hasActions = actions.length > 0;
  const hasFailures = failures.total > 0;

  return (
    <section className={styles.section} aria-label="Needs attention">
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          <span className={styles.eyebrowPulse} data-quiet={hasActions || hasFailures ? undefined : "true"} aria-hidden="true" />
          Needs attention
        </span>
        <p className={styles.subtitle}>
          {hasActions || hasFailures
            ? "The signals worth acting on right now — pulled from your live runs, senders, and lists."
            : "A live read on what needs you. Nothing is blocking your sending right now."}
        </p>
      </header>

      {hasActions || hasFailures ? (
        <div className={styles.body}>
          <ActionPanel actions={actions} />
          <FailurePanel failures={failures} />
        </div>
      ) : (
        <div className={styles.allClear}>
          <span className={styles.allClearIcon}>
            <CheckCircle2 aria-hidden="true" />
          </span>
          <div>
            <strong>You&apos;re all caught up</strong>
            <p>No failures, no disconnected senders, nothing waiting on you. Sequences are free to keep moving.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function PanelHeading({ icon: Icon, kicker, title, meta }: { icon: LucideIcon; kicker: string; title: string; meta?: string }) {
  return (
    <div className={styles.panelHeading}>
      <span className={styles.panelIcon}>
        <Icon aria-hidden="true" />
      </span>
      <div className={styles.panelHeadingCopy}>
        <span className={styles.panelKicker}>{kicker}</span>
        <strong className={styles.panelTitle}>{title}</strong>
      </div>
      {meta ? <span className={styles.panelMeta}>{meta}</span> : null}
    </div>
  );
}

function ActionPanel({ actions }: { actions: ActionItem[] }) {
  return (
    <article className={styles.panel}>
      <PanelHeading icon={Gauge} kicker="Action center" title="What needs you" />
      {actions.length ? (
        <ul className={styles.actionList}>
          {actions.map((action) => (
            <li key={action.key}>
              <Link href={action.href as Route} className={styles.actionItem} data-tone={action.tone}>
                <span className={styles.actionCount}>{formatCompactNumber(action.count)}</span>
                <span className={styles.actionCopy}>
                  <strong>{action.label}</strong>
                  <span>{action.detail}</span>
                </span>
                <span className={styles.actionCta}>
                  {action.cta}
                  <ArrowRight aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <PanelClear message="No pending actions — every sender and list is good to go." />
      )}
    </article>
  );
}

function FailurePanel({ failures }: { failures: OverviewAttention["failures"] }) {
  const retryShare = failures.total > 0 ? Math.round((failures.retryable / failures.total) * 100) : 0;
  return (
    <article className={styles.panel}>
      <PanelHeading
        icon={ShieldAlert}
        kicker="Delivery issues"
        title="Retryable vs action-required"
        meta={failures.lastFailureLabel ? `last ${failures.lastFailureLabel}` : undefined}
      />
      {failures.total > 0 ? (
        <>
          <div className={styles.split}>
            <div className={styles.splitBar} aria-hidden="true">
              <span className={styles.splitRetry} style={{ width: `${retryShare}%` }} />
            </div>
            <div className={styles.splitLegend}>
              <span>
                <i className={styles.dotRetry} aria-hidden="true" /> Will retry <b>{formatCompactNumber(failures.retryable)}</b>
              </span>
              <span>
                <i className={styles.dotPermanent} aria-hidden="true" /> Needs action <b>{formatCompactNumber(failures.permanent)}</b>
              </span>
            </div>
          </div>
          <ul className={styles.failureList}>
            {failures.categories.map((category) => (
              <FailureRow key={category.key} category={category} />
            ))}
          </ul>
        </>
      ) : (
        <PanelClear message="No delivery failures — everything is landing cleanly." />
      )}
    </article>
  );
}

function FailureRow({ category }: { category: FailureCategory }) {
  return (
    <li className={styles.failureItem} data-tone={category.tone}>
      <span className={styles.failureDot} aria-hidden="true" />
      <div className={styles.failureCopy}>
        <strong>{category.label}</strong>
        <span>{category.description}</span>
      </div>
      <b className={styles.failureCount}>{formatCompactNumber(category.value)}</b>
    </li>
  );
}

function PanelClear({ message }: { message: string }) {
  return (
    <div className={styles.panelClear}>
      <span className={styles.panelClearIcon}>
        <CheckCircle2 aria-hidden="true" />
      </span>
      <p>{message}</p>
    </div>
  );
}
