"use client";

import Link from "next/link";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "next";
import {
  ArrowLeft,
  AtSign,
  Building2,
  CheckCircle2,
  LoaderCircle,
  Network,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
  WifiOff,
  X
} from "lucide-react";

import type { DiscoverQuota, ProspectSearchNode } from "@/components/prospects/prospect-graphql";
import { formatQuotaReset, formatSearchError, isProcessQuotaBlocked } from "@/components/prospects/prospect-view";
import {
  BACKGROUND_REASSURANCE,
  PROCESSING_STAGES,
  type ProcessingPhase,
  RECONNECTING_REASSURANCE,
  describeProcessingStatus,
  resolveAriaBusy,
  resolveDocumentTitle,
  resolveHeadline,
  resolveParticleCount,
  resolveProcessingPhase,
  resolveStageProgress,
  resolveStageStates
} from "@/components/prospects/prospect-processing";
import { useProspectProcessingSync } from "@/components/prospects/use-prospect-processing-sync";
import styles from "@/components/prospects/prospect-processing.module.css";

const STAGE_ICONS = [Building2, Users, Network, AtSign, Sparkles] as const;

// Signature-visual geometry (viewBox 0 0 220 220). The 4 satellite nodes map to
// the first 4 pipeline stages; the 5th (finalizing) is the core lighting up.
const CENTER = 110;
const RING_RADIUS = 86;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
// The satellite nodes sit on the ring at the four diagonals.
const DIAGONAL = RING_RADIUS * Math.sin(Math.PI / 4);
const NODES = [
  { x: CENTER - DIAGONAL, y: CENTER - DIAGONAL }, // stage 0 — top-left
  { x: CENTER + DIAGONAL, y: CENTER - DIAGONAL }, // stage 1 — top-right
  { x: CENTER + DIAGONAL, y: CENTER + DIAGONAL }, // stage 2 — bottom-right
  { x: CENTER - DIAGONAL, y: CENTER + DIAGONAL } // stage 3 — bottom-left
] as const;
const LINK_INNER = 40; // where a connecting line starts, outside the core

type Particle = {
  x: string;
  y: string;
  size: string;
  duration: string;
  delay: string;
  driftX: string;
  peak: number;
};

// Deterministic pseudo-random particle field (stable across renders so the
// motion never reshuffles). Positions favour the composition edges.
function buildParticles(count: number): Particle[] {
  const particles: Particle[] = [];
  for (let index = 0; index < count; index += 1) {
    const golden = (index * 0.61803398875) % 1;
    const alt = (index * 0.7548776662 + 0.37) % 1;
    particles.push({
      x: `${Math.round(golden * 100)}%`,
      y: `${Math.round((8 + alt * 84))}%`,
      size: `${3 + (index % 3)}px`,
      duration: `${9 + (index % 5) * 1.6}s`,
      delay: `${(index % 7) * 0.8}s`,
      driftX: `${(index % 2 === 0 ? 1 : -1) * (6 + (index % 4) * 4)}px`,
      peak: 0.35 + (index % 3) * 0.12
    });
  }
  return particles;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const update = () => setHidden(document.visibilityState === "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}

export function ProspectProcessingExperience({
  search,
  quota,
  starting,
  companyName,
  onStart,
  onCancel,
  reconcile
}: {
  search: ProspectSearchNode;
  quota: DiscoverQuota | null;
  /** A start request the user just triggered is in flight. */
  starting: boolean;
  companyName?: string | null;
  onStart: () => void;
  onCancel: () => void;
  /** Authoritative status refresh — resolves true on success, never throws. */
  reconcile: () => Promise<boolean>;
}) {
  const status = search.status;
  const { online } = useProspectProcessingSync({ status, starting, reconcile });
  const reducedMotion = usePrefersReducedMotion();
  const documentHidden = useDocumentHidden();

  const phase = resolveProcessingPhase({ status, starting, online });
  const stageProgress = resolveStageProgress(status);
  const stageStates = resolveStageStates(status);
  const busy = resolveAriaBusy(phase);
  const staticMotion = reducedMotion || documentHidden || phase === "RECONNECTING";

  // Responsive, capped particle count. Starts from the current viewport so the
  // field is correct on first paint (this component only mounts client-side).
  const [particleCount, setParticleCount] = useState(() =>
    typeof window === "undefined" ? 12 : resolveParticleCount({ viewportWidth: window.innerWidth, reducedMotion: false })
  );
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const update = () =>
      setParticleCount(resolveParticleCount({ viewportWidth: window.innerWidth, reducedMotion }));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [reducedMotion]);
  const particles = useMemo(() => buildParticles(particleCount), [particleCount]);

  // Document title — updated ONCE per meaningful phase change, then restored.
  const originalTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (originalTitleRef.current === null) {
      originalTitleRef.current = document.title;
    }
    const next = resolveDocumentTitle(phase);
    if (next && document.title !== next) {
      document.title = next;
    }
    return () => {
      if (originalTitleRef.current !== null) {
        document.title = originalTitleRef.current;
      }
    };
  }, [phase]);

  const error = phase === "FAILED" ? formatSearchError(search) : null;
  const liveMessage = describeProcessingStatus({ phase, status, companyName });
  const quotaBlocked = isProcessQuotaBlocked(quota, status);
  const quotaReset = formatQuotaReset(quota);
  const ringOffset = RING_CIRCUMFERENCE * (1 - stageProgress.percent / 100);

  return (
    <section
      className={styles.shell}
      data-phase={phase}
      data-reduced={reducedMotion ? "true" : "false"}
      data-static={staticMotion ? "true" : "false"}
      aria-busy={busy}
      data-discover-tour="status-summary"
    >
      {/* Decorative backdrop — hidden from assistive tech. */}
      <div className={styles.backdrop} aria-hidden="true">
        <div className={styles.grid} />
        <div className={styles.particles} data-paused={documentHidden ? "true" : "false"}>
          {particles.map((particle, index) => (
            <span
              key={index}
              className={styles.particle}
              style={
                {
                  "--x": particle.x,
                  "--y": particle.y,
                  "--size": particle.size,
                  "--duration": particle.duration,
                  "--delay": particle.delay,
                  "--drift-x": particle.driftX,
                  "--peak-opacity": particle.peak
                } as CSSProperties
              }
            />
          ))}
        </div>
      </div>

      <ProcessingVisual phase={phase} percent={stageProgress.percent} ringOffset={ringOffset} stageStates={stageStates} />

      <div className={styles.panel}>
        {/* Polite live region — coarse, stage-level, never per-percent chatter. */}
        <p className={styles.srOnly} role="status" aria-live="polite">
          {liveMessage}
        </p>

        {phase === "FAILED" && error ? (
          <FailureState
            title={error.title}
            message={error.message}
            retryable={error.retryable}
            starting={starting}
            onRetry={onStart}
          />
        ) : (
          <RunningPanel
            phase={phase}
            search={search}
            companyName={companyName}
            stageProgress={stageProgress}
            starting={starting}
            quotaBlocked={quotaBlocked}
            quotaReset={quotaReset}
            perSearch={quota?.resultsPerSearch ?? 10}
            dailyLimit={quota?.dailySearchLimit ?? 4}
            onStart={onStart}
            onCancel={onCancel}
          />
        )}

        {phase !== "FAILED" && <StageTrail stageStates={stageStates} />}
      </div>
    </section>
  );
}

function ProcessingVisual({
  phase,
  percent,
  ringOffset,
  stageStates
}: {
  phase: string;
  percent: number;
  ringOffset: number;
  stageStates: string[];
}) {
  const showPercent = (phase === "RUNNING" || phase === "RECONNECTING") && percent > 0;
  const complete = phase === "COMPLETED";
  return (
    <div className={styles.visual}>
      <svg className={styles.orbit} viewBox="0 0 220 220" role="img" aria-label="Sendloom is preparing your results">
        <defs>
          <linearGradient id="procRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--proc-accent)" />
            <stop offset="100%" stopColor="var(--proc-accent-strong)" />
          </linearGradient>
          <radialGradient id="procCoreGradient" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor="var(--proc-accent-strong)" />
            <stop offset="100%" stopColor="var(--proc-accent)" />
          </radialGradient>
        </defs>

        {/* Connecting lines from the core to each satellite node. */}
        {NODES.map((node, index) => {
          const state = complete ? "done" : stageStates[index] ?? "pending";
          const ux = (node.x - CENTER) / RING_RADIUS;
          const uy = (node.y - CENTER) / RING_RADIUS;
          return (
            <line
              key={`link-${index}`}
              className={styles.link}
              data-state={state}
              x1={CENTER + ux * LINK_INNER}
              y1={CENTER + uy * LINK_INNER}
              x2={node.x}
              y2={node.y}
            />
          );
        })}

        <circle className={styles.ringTrack} cx={CENTER} cy={CENTER} r={RING_RADIUS} />
        <circle
          className={styles.ringProgress}
          cx={CENTER}
          cy={CENTER}
          r={RING_RADIUS}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={ringOffset}
        />

        {/* Satellite nodes. Each pulses while its stage is active. */}
        {NODES.map((node, index) => {
          const state = complete ? "done" : stageStates[index] ?? "pending";
          return (
            <g key={`node-${index}`}>
              <circle className={styles.node} data-state={state} cx={node.x} cy={node.y} r={9} />
              <circle className={styles.nodePulse} cx={node.x} cy={node.y} r={9} />
            </g>
          );
        })}

        {/* Core. */}
        <circle className={styles.coreGlow} cx={CENTER} cy={CENTER} r={46} />
        <circle className={styles.core} cx={CENTER} cy={CENTER} r={34} />
        {complete ? (
          <path className={styles.checkPath} d="M96 111 l10 11 l19 -22" />
        ) : showPercent ? (
          <text className={styles.corePercent} x={CENTER} y={CENTER}>
            {percent}%
          </text>
        ) : (
          <path className={styles.coreMark} d="M97 118 v-16 l13 9 l13 -9 v16" />
        )}
      </svg>
    </div>
  );
}

function RunningPanel({
  phase,
  search,
  companyName,
  stageProgress,
  starting,
  quotaBlocked,
  quotaReset,
  perSearch,
  dailyLimit,
  onStart,
  onCancel
}: {
  phase: ProcessingPhase;
  search: ProspectSearchNode;
  companyName?: string | null;
  stageProgress: ReturnType<typeof resolveStageProgress>;
  starting: boolean;
  quotaBlocked: boolean;
  quotaReset: string | null;
  perSearch: number;
  dailyLimit: number;
  onStart: () => void;
  onCancel: () => void;
}) {
  const name = companyName?.trim() || search.requestedCompany;
  const initializing = phase === "INITIALIZING";
  const reconnecting = phase === "RECONNECTING";
  const completed = phase === "COMPLETED";
  const headline = resolveHeadline(phase);
  const eyebrow = completed
    ? "Complete"
    : reconnecting
      ? "Reconnecting"
      : initializing
        ? "Discover"
        : "Working";

  return (
    <>
      <span className={styles.eyebrow}>
        {reconnecting ? (
          <WifiOff aria-hidden="true" />
        ) : completed ? (
          <CheckCircle2 aria-hidden="true" />
        ) : (
          <span className={styles.eyebrowDot} aria-hidden="true" />
        )}
        {eyebrow}
      </span>

      <h1 className={styles.headline}>{headline}</h1>

      {/* Active stage label + honest step counter (RUNNING / RECONNECTING). */}
      {stageProgress.stage && !completed ? (
        <div className={styles.stageLabel}>
          <span key={stageProgress.stage.key} className={`${styles.stageName} ${styles.stageEnter}`}>
            {stageProgress.stage.detail}
          </span>
          <span className={styles.stepCounter}>{stageProgress.stepLabel}</span>
        </div>
      ) : initializing ? (
        <p className={styles.stageName}>
          Sendloom will resolve {name}, find matching people, and prepare their work contacts — up to {perSearch} people.
        </p>
      ) : completed ? (
        <div className={styles.stageLabel}>
          <span className={styles.stageName}>Opening your results…</span>
        </div>
      ) : null}

      {/* Determinate meter — fills only as the backend advances; never fakes. */}
      {!initializing && (
        <div className={styles.meter} aria-hidden="true">
          <span className={styles.meterFill} style={{ transform: `scaleX(${stageProgress.percent / 100})` }} />
        </div>
      )}

      {reconnecting ? (
        <div className={styles.reassurance} data-tone="reconnecting">
          <WifiOff aria-hidden="true" />
          <span>{RECONNECTING_REASSURANCE}</span>
        </div>
      ) : !completed ? (
        <div className={styles.reassurance}>
          <ShieldCheck aria-hidden="true" />
          <span>{BACKGROUND_REASSURANCE}</span>
        </div>
      ) : null}

      {initializing && quotaBlocked ? (
        <p className={styles.failureMessage}>
          You&apos;ve used today&apos;s {dailyLimit} Discover searches.{quotaReset ? ` ${quotaReset}.` : ""}
        </p>
      ) : null}

      <div className={styles.actions}>
        {initializing && (
          <button type="button" className={styles.primaryButton} onClick={onStart} disabled={starting || quotaBlocked}>
            {starting ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <Play aria-hidden="true" />}
            <span>{starting ? "Starting…" : "Start search"}</span>
          </button>
        )}
        {(initializing || (!completed && !reconnecting)) && (
          <button type="button" className={styles.secondaryButton} onClick={onCancel} disabled={starting}>
            <X aria-hidden="true" />
            <span>Cancel</span>
          </button>
        )}
      </div>
    </>
  );
}

function StageTrail({ stageStates }: { stageStates: string[] }) {
  return (
    <ul className={styles.trail} aria-hidden="true">
      {PROCESSING_STAGES.map((stage, index) => {
        const Icon = STAGE_ICONS[index] ?? Sparkles;
        const state = stageStates[index] ?? "pending";
        return (
          <li key={stage.key} className={styles.trailItem} data-state={state} data-stage={stage.key}>
            <span className={styles.trailIcon}>
              {state === "done" ? <CheckCircle2 aria-hidden="true" /> : <Icon aria-hidden="true" />}
            </span>
            <span className={styles.trailText}>
              <span className={styles.trailLabel}>{stage.label}</span>
              <span className={styles.trailDetail}>{stage.detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function FailureState({
  title,
  message,
  retryable,
  starting,
  onRetry
}: {
  title: string;
  message: string;
  retryable: boolean;
  starting: boolean;
  onRetry: () => void;
}) {
  return (
    <>
      <span className={styles.failureIcon} aria-hidden="true">
        <TriangleAlert />
      </span>
      <h1 className={styles.headline}>{title}</h1>
      <p className={styles.failureMessage}>{message}</p>
      <div className={styles.actions}>
        {retryable && (
          <button type="button" className={styles.primaryButton} onClick={onRetry} disabled={starting}>
            {starting ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <RefreshCw aria-hidden="true" />}
            <span>{starting ? "Retrying…" : "Retry search"}</span>
          </button>
        )}
        <Link href={"/prospects" as Route} className={styles.secondaryButton}>
          <ArrowLeft aria-hidden="true" />
          <span>Back to Discover</span>
        </Link>
      </div>
    </>
  );
}
