"use client";

import { type CSSProperties } from "react";

import {
  BRAND_LEAD,
  BRAND_TAIL,
  PARTICLE_TOTAL,
  SPLASH_STAGES,
  SPLASH_STATUS_LABEL,
  WORKFLOW_STEPS
} from "@/components/startup-splash-core";
import { useStartupReadiness } from "@/components/use-startup-readiness";
import styles from "@/components/startup-splash.module.css";

// ---------------------------------------------------------------------------
// Deterministic particle field (index-based) so the server render and the first
// client render agree — no hydration mismatch, no resize listener. CSS
// breakpoints cap how many actually drift on smaller viewports.
// ---------------------------------------------------------------------------

type Particle = {
  x: string;
  y: string;
  size: string;
  duration: string;
  delay: string;
  driftX: string;
  peak: number;
  variant: "point" | "square" | "streak" | "bright";
};

function buildParticles(): Particle[] {
  const particles: Particle[] = [];
  for (let index = 0; index < PARTICLE_TOTAL; index += 1) {
    const golden = (index * 0.61803398875) % 1;
    const alt = (index * 0.7548776662 + 0.19) % 1;
    const variant: Particle["variant"] =
      index % 9 === 4 ? "bright" : index % 11 === 3 ? "streak" : index % 5 === 0 ? "square" : "point";
    particles.push({
      x: `${Math.round(4 + golden * 92)}%`,
      y: `${Math.round(6 + alt * 88)}%`,
      size: `${2 + (index % 4)}px`,
      duration: `${11 + (index % 6) * 1.6}s`,
      delay: `${(index % 7) * 0.6}s`,
      driftX: `${(index % 2 === 0 ? 1 : -1) * (8 + (index % 5) * 4)}px`,
      peak: 0.22 + (index % 4) * 0.13,
      variant
    });
  }
  return particles;
}

const PARTICLES = buildParticles();

// ---------------------------------------------------------------------------
// Signal system. A few scattered signals (company, person, email, message,
// reply) flow along curved paths and weave together under the wordmark; one
// clean outbound path continues past it. Geometry is in a 1440×900 canvas that
// is sliced to fill any viewport.
// ---------------------------------------------------------------------------

type SignalKind = "company" | "person" | "email" | "message" | "timing";

// Scattered origins sweep in from the left/top/bottom on woven curves and gather
// at a knot just below the wordmark; one controlled path exits bottom-right.
// The two near-vertical paths keep the loom legible on narrow (mobile) crops.
const KNOT: [number, number] = [720, 580];
const SIGNALS: { d: string; node: [number, number]; kind: SignalKind; index: number }[] = [
  { d: "M150,130 C400,215 540,430 706,566", node: [150, 130], kind: "company", index: 0 },
  { d: "M95,395 C300,355 530,490 703,572", node: [95, 395], kind: "person", index: 1 },
  { d: "M170,720 C380,700 560,630 702,588", node: [170, 720], kind: "email", index: 2 },
  { d: "M640,90 C666,250 694,430 717,564", node: [640, 90], kind: "timing", index: 3 },
  { d: "M980,720 C910,678 800,640 733,594", node: [980, 720], kind: "message", index: 4 }
];
const OUTBOUND = "M720,580 C920,616 1150,610 1380,710";

function SignalSymbol({ kind }: { kind: SignalKind }) {
  switch (kind) {
    case "company":
      return <rect x={-5} y={-5} width={10} height={10} rx={1.5} className={styles.symbolStroke} />;
    case "person":
      return (
        <>
          <circle cx={0} cy={-3} r={3} className={styles.symbolStroke} />
          <path d="M-5,6 C-5,1 5,1 5,6" className={styles.symbolStroke} />
        </>
      );
    case "email":
      return (
        <>
          <rect x={-6} y={-4} width={12} height={9} rx={1.5} className={styles.symbolStroke} />
          <path d="M-6,-3 L0,2 L6,-3" className={styles.symbolStroke} />
        </>
      );
    case "message":
      return (
        <>
          <rect x={-6} y={-5} width={12} height={9} rx={2.5} className={styles.symbolStroke} />
          <path d="M-2,4 L-2,8 L2,4" className={styles.symbolStroke} />
        </>
      );
    case "timing":
    default:
      return (
        <>
          <circle cx={0} cy={0} r={5.5} className={styles.symbolStroke} />
          <path d="M0,-2.5 L0,0.5 L3,2" className={styles.symbolStroke} />
        </>
      );
  }
}

// SEND reads solid; LOOM reads constructed/outlined. Split into letter spans for
// a kinetic, staggered reveal.
function Wordmark() {
  const lead = BRAND_LEAD.split("");
  const tail = BRAND_TAIL.split("");
  let cursor = 0;
  return (
    <div className={styles.wordmark} aria-hidden="true">
      <svg className={styles.threads} viewBox="0 0 620 40" preserveAspectRatio="none" aria-hidden="true">
        <path className={styles.thread} d="M8,20 H612" pathLength={100} />
        <path className={styles.thread} d="M40,10 H580" pathLength={100} style={{ animationDelay: "0.15s" } as CSSProperties} />
        <path className={styles.thread} d="M40,30 H580" pathLength={100} style={{ animationDelay: "0.3s" } as CSSProperties} />
      </svg>
      <span className={styles.word}>
        {lead.map((letter, i) => {
          const style = { "--i": cursor++ } as CSSProperties;
          return (
            <span key={`lead-${i}`} className={styles.lead} style={style}>
              {letter}
            </span>
          );
        })}
        {tail.map((letter, i) => {
          const style = { "--i": cursor++ } as CSSProperties;
          return (
            <span key={`tail-${i}`} className={styles.tail} style={style} data-letter={letter}>
              {letter}
            </span>
          );
        })}
      </span>
      <span className={styles.sweep} />
    </div>
  );
}

export function StartupSplash() {
  const { phase, stage } = useStartupReadiness();

  if (phase === "done") {
    return null;
  }

  const stageLabel = SPLASH_STAGES[stage] ?? SPLASH_STAGES[0];

  return (
    <div className={styles.overlay} data-loader-overlay="" data-phase={phase} aria-busy={phase === "loading"}>
      {/* Layered backdrop — all decorative, hidden from assistive tech. */}
      <div className={styles.backdrop} aria-hidden="true">
        <div className={styles.glow} />
        <div className={styles.grid} />
        <svg className={styles.weave} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <path d="M-100,700 C300,520 700,880 1560,540" className={styles.weaveArc} pathLength={100} />
          <path d="M-100,540 C420,760 900,360 1560,700" className={styles.weaveArc} pathLength={100} />
          <path d="M-100,320 C380,180 980,520 1560,240" className={styles.weaveArc} pathLength={100} />
        </svg>
        <div className={styles.particles}>
          {PARTICLES.map((particle, index) => (
            <span
              key={index}
              className={styles.particle}
              data-variant={particle.variant}
              style={
                {
                  "--x": particle.x,
                  "--y": particle.y,
                  "--size": particle.size,
                  "--duration": particle.duration,
                  "--delay": particle.delay,
                  "--drift-x": particle.driftX,
                  "--peak": particle.peak
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className={styles.vignette} />
      </div>

      {/* Signal system. */}
      <svg className={styles.signals} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="splashNodeGradient" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor="var(--accent-strong)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </radialGradient>
        </defs>

        <path className={styles.wire} d={OUTBOUND} />
        <path className={styles.wireDraw} d={OUTBOUND} pathLength={100} style={{ "--delay": "0.55s" } as CSSProperties} />
        {/* Evenly spaced pulses out (controlled sending) and one reply signal back. */}
        <path className={styles.sendPulses} d={OUTBOUND} pathLength={100} style={{ "--delay": "0.9s" } as CSSProperties} />
        <path className={styles.replyPulse} d={OUTBOUND} pathLength={100} style={{ "--delay": "1.5s" } as CSSProperties} />

        {SIGNALS.map((signal) => {
          const delay = `${0.05 + signal.index * 0.08}s`;
          const pulseDelay = `${0.35 + signal.index * 0.12}s`;
          return (
            <g key={signal.kind}>
              <path className={styles.wire} d={signal.d} />
              <path className={styles.wireDraw} d={signal.d} pathLength={100} style={{ "--delay": delay } as CSSProperties} />
              <path className={styles.pulse} d={signal.d} pathLength={100} style={{ "--delay": pulseDelay } as CSSProperties} />
            </g>
          );
        })}

        {/* Convergence knot beneath the wordmark, where the threads gather. */}
        <circle className={styles.coreHalo} cx={KNOT[0]} cy={KNOT[1]} r={20} />
        <circle className={styles.core} cx={KNOT[0]} cy={KNOT[1]} r={7.5} />

        {SIGNALS.map((signal) => (
          // Outer g holds position; the animated class lives on an inner g so the
          // CSS transform animation cannot override the translate attribute.
          <g key={`node-${signal.kind}`} transform={`translate(${signal.node[0]}, ${signal.node[1]})`}>
            <g className={styles.node} style={{ "--delay": `${signal.index * 0.09}s` } as CSSProperties}>
              <circle className={styles.nodeDisc} r={17} />
              <g transform="scale(1.3)">
                <SignalSymbol kind={signal.kind} />
              </g>
            </g>
          </g>
        ))}
        <circle className={styles.replyNode} cx={1380} cy={710} r={5} />
      </svg>

      {/* Focal wordmark. */}
      <div className={styles.stage}>
        <Wordmark />
      </div>

      {/* Segmented readiness readout + stage copy, anchored near the bottom so
          the signal knot beneath the wordmark stays clear. */}
      <div className={styles.footer}>
        <div className={styles.readout} aria-hidden="true">
          <div className={styles.track}>
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className={styles.segment} style={{ "--i": i } as CSSProperties} />
            ))}
            <span className={styles.readPulse} />
          </div>
        </div>
        <p className={styles.stageCopy} role="status" aria-live="polite">
          {stageLabel}
        </p>
      </div>

      {/* Brand workflow labels distributed across the composition. */}
      <div className={styles.workflow} aria-hidden="true">
        {WORKFLOW_STEPS.map((step, i) => (
          <span key={step} className={styles.step} data-step={step.toLowerCase()} style={{ "--i": i } as CSSProperties}>
            <span className={styles.stepDot} />
            {step}
          </span>
        ))}
      </div>

      <span className={styles.srOnly}>{SPLASH_STATUS_LABEL}</span>
    </div>
  );
}
