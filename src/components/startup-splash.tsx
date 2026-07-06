"use client";

import { type CSSProperties } from "react";

import { renderBrandText } from "@/components/brand-text";
import {
  PARTICLE_TOTAL,
  SPLASH_HEADLINE,
  SPLASH_STATUS_LABEL,
  SPLASH_SUBTEXT
} from "@/components/startup-splash-core";
import { useStartupReadiness } from "@/components/use-startup-readiness";
import styles from "@/components/startup-splash.module.css";

type Particle = { x: string; y: string; size: string; duration: string; delay: string; driftX: string; peak: number };

// Deterministic field (index-based) so the server render and the first client
// render agree — no hydration mismatch, no resize listener. CSS breakpoints cap
// how many actually drift on smaller viewports.
function buildParticles(): Particle[] {
  const particles: Particle[] = [];
  for (let index = 0; index < PARTICLE_TOTAL; index += 1) {
    const golden = (index * 0.61803398875) % 1;
    const alt = (index * 0.7548776662 + 0.29) % 1;
    particles.push({
      x: `${Math.round(6 + golden * 88)}%`,
      y: `${Math.round(10 + alt * 80)}%`,
      size: `${3 + (index % 3)}px`,
      duration: `${9 + (index % 5) * 1.5}s`,
      delay: `${(index % 6) * 0.7}s`,
      driftX: `${(index % 2 === 0 ? 1 : -1) * (6 + (index % 4) * 3)}px`,
      peak: 0.3 + (index % 3) * 0.1
    });
  }
  return particles;
}

const PARTICLES = buildParticles();

// The Signal Loom mark: four scattered signals (company, person, email,
// outreach) woven into one clean outreach line.
const STRANDS = [
  "M6,12 C30,12 40,28 58,36",
  "M6,28 C28,28 44,33 58,36",
  "M6,44 C28,44 44,39 58,36",
  "M6,60 C30,60 40,44 58,36"
] as const;
const STRAND_NODES = [12, 28, 44, 60] as const;

export function StartupSplash() {
  const phase = useStartupReadiness();

  if (phase === "done") {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      data-loader-overlay=""
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-busy={phase === "loading"}
    >
      <div className={styles.backdrop} aria-hidden="true">
        <div className={styles.grid} />
        <div className={styles.particles}>
          {PARTICLES.map((particle, index) => (
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
                  "--peak": particle.peak
                } as CSSProperties
              }
            />
          ))}
        </div>
      </div>

      <div className={styles.composition}>
        <svg className={styles.mark} viewBox="0 0 96 72" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id="splashCoreGradient" cx="35%" cy="30%" r="80%">
              <stop offset="0%" stopColor="var(--accent-strong)" />
              <stop offset="100%" stopColor="var(--accent)" />
            </radialGradient>
          </defs>

          {STRANDS.map((d, index) => (
            <path key={`strand-${index}`} className={styles.glyphStrand} d={d} />
          ))}
          <path className={styles.glyphMerge} d="M58,36 L90,36" />

          {STRAND_NODES.map((y, index) => (
            <circle key={`node-${index}`} className={styles.glyphNode} cx={6} cy={y} r={3} />
          ))}
          <circle className={styles.glyphNodeEnd} cx={90} cy={36} r={3.5} />

          <circle className={styles.glyphCoreRing} cx={58} cy={36} r={7} />
          <circle className={styles.glyphCore} cx={58} cy={36} r={7} />
        </svg>

        <h1 className={styles.headline}>{renderBrandText(SPLASH_HEADLINE)}</h1>
        <p className={styles.subtext}>{SPLASH_SUBTEXT}</p>

        <div className={styles.progress} aria-hidden="true">
          <span className={styles.progressBar} />
        </div>

        <span className={styles.srOnly}>{SPLASH_STATUS_LABEL}</span>
      </div>
    </div>
  );
}
