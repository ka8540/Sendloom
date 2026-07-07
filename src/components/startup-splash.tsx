"use client";

import { type CSSProperties } from "react";

import { BrandText } from "@/components/brand-text";
import { SendloomLogo } from "@/components/sendloom-logo";
import {
  BRAND,
  BRAND_TAGLINE,
  COMMAND_MODULES,
  PARTICLE_TOTAL,
  SPLASH_STAGES,
  SPLASH_STATUS_LABEL,
  type CommandModuleKey
} from "@/components/startup-splash-core";
import { useStartupReadiness } from "@/components/use-startup-readiness";
import styles from "@/components/startup-splash.module.css";

// ---------------------------------------------------------------------------
// Deterministic sparse particle field (index-based) so the server render and
// the first client render agree — no hydration mismatch, no resize listener.
// CSS breakpoints cap how many actually drift on smaller viewports.
// ---------------------------------------------------------------------------

type Particle = {
  x: string;
  y: string;
  size: string;
  duration: string;
  delay: string;
  peak: number;
};

function buildParticles(): Particle[] {
  const particles: Particle[] = [];
  for (let index = 0; index < PARTICLE_TOTAL; index += 1) {
    const golden = (index * 0.61803398875) % 1;
    const alt = (index * 0.7548776662 + 0.23) % 1;
    particles.push({
      x: `${Math.round(5 + golden * 90)}%`,
      y: `${Math.round(8 + alt * 84)}%`,
      size: `${2 + (index % 3)}px`,
      duration: `${12 + (index % 5) * 1.7}s`,
      delay: `${(index % 6) * 0.7}s`,
      peak: 0.16 + (index % 4) * 0.09
    });
  }
  return particles;
}

const PARTICLES = buildParticles();

// ---------------------------------------------------------------------------
// Command map geometry — a hub-and-spoke operations map in a 760×640 canvas
// (preserveAspectRatio "meet": the whole map always stays visible). Six module
// panels dock in orbit around the Sendloom core; thin routing spokes link each
// panel to the core; paced pulses circulate the orbit; a send pulse leaves the
// core down the SEND spoke and a reply pulse returns along TRACK.
// ---------------------------------------------------------------------------

const CORE: [number, number] = [380, 296];
const PANEL_W = 168;
const PANEL_H = 88;

type PanelSpec = {
  key: CommandModuleKey;
  /** Panel top-left corner. */
  x: number;
  y: number;
  /** Routing spoke from panel edge to the core ring. */
  spoke: string;
  /** Entry slide direction (panels dock inward from their orbital side). */
  ex: number;
  ey: number;
};

const PANELS: PanelSpec[] = [
  { key: "import", x: 97, y: 137, spoke: "M257,225 L318,260", ex: -20, ey: -12 },
  { key: "enrich", x: 296, y: 22, spoke: "M380,110 L380,224", ex: 0, ey: -22 },
  { key: "template", x: 495, y: 137, spoke: "M503,225 L442,260", ex: 20, ey: -12 },
  { key: "sequence", x: 495, y: 367, spoke: "M503,367 L442,332", ex: 20, ey: 12 },
  { key: "send", x: 296, y: 482, spoke: "M380,482 L380,368", ex: 0, ey: 22 },
  { key: "track", x: 97, y: 367, spoke: "M257,367 L318,332", ex: -20, ey: 12 }
];

// Send leaves the core downward (through the SEND spoke); the reply returns to
// the core along the TRACK spoke. Both are decorative pulses, wall-clock free.
const SEND_PULSE_PATH = "M380,368 L380,482";
const REPLY_PULSE_PATH = "M257,367 L318,332";

// ---------------------------------------------------------------------------
// Module glyphs — small meaningful graphics, one per workflow module, drawn in
// a 36×28 stroke box. Shared by the desktop panels and the mobile module rows.
// ---------------------------------------------------------------------------

function ModuleGlyph({ kind }: { kind: CommandModuleKey }) {
  switch (kind) {
    case "import":
      // A mini spreadsheet with rows/columns, plus an arrow dropping rows in.
      return (
        <>
          <rect x={1} y={3} width={26} height={20} rx={2.5} className={styles.glyphStroke} />
          <path d="M1,10 H27" className={styles.glyphStroke} />
          <path d="M1,16.5 H27" className={styles.glyphStroke} />
          <path d="M9.5,3 V23" className={styles.glyphFaint} />
          <path d="M32.5,6 V13" className={styles.glyphAccent} />
          <path d="M29.5,10.5 L32.5,13.8 L35.5,10.5" className={styles.glyphAccent} />
        </>
      );
    case "enrich":
      // A person node receiving data points from the right.
      return (
        <>
          <circle cx={9} cy={8} r={4.2} className={styles.glyphStroke} />
          <path d="M2,23 C2,15.8 16,15.8 16,23" className={styles.glyphStroke} />
          <path d="M22,9 H31" className={styles.glyphAccent} />
          <circle cx={33.5} cy={9} r={1.7} className={styles.glyphAccentFill} />
          <path d="M22,16 H27.5" className={styles.glyphAccent} />
          <circle cx={30} cy={16} r={1.7} className={styles.glyphAccentFill} />
        </>
      );
    case "template":
      // A message card with a highlighted merge-variable token.
      return (
        <>
          <rect x={1} y={2} width={25} height={22} rx={3} className={styles.glyphStroke} />
          <path d="M5.5,8 H21.5" className={styles.glyphStroke} />
          <rect x={5.5} y={12} width={9.5} height={5} rx={1.6} className={styles.glyphToken} />
          <path d="M18,14.5 H21.5" className={styles.glyphFaint} />
          <path d="M5.5,20.5 H16" className={styles.glyphFaint} />
          <path d="M31,7 V12 M28.5,9.5 H33.5" className={styles.glyphAccent} />
        </>
      );
    case "sequence":
      // An ordered timeline rail: step dots with even interval ticks.
      return (
        <>
          <path d="M2,14 H34" className={styles.glyphFaint} />
          <circle cx={7} cy={14} r={3} className={styles.glyphAccentFill} />
          <circle cx={19} cy={14} r={3} className={styles.glyphStroke} />
          <circle cx={31} cy={14} r={3} className={styles.glyphStroke} />
          <path d="M13,9.5 V18.5" className={styles.glyphFaint} />
          <path d="M25,9.5 V18.5" className={styles.glyphFaint} />
        </>
      );
    case "send":
      // The connected Gmail channel: envelope with paced outbound arcs.
      return (
        <>
          <rect x={1} y={5} width={22} height={16} rx={2.5} className={styles.glyphStroke} />
          <path d="M2.5,7 L12,15 L21.5,7" className={styles.glyphStroke} />
          <path d="M27,9.5 C29.6,11.4 29.6,14.6 27,16.5" className={styles.glyphAccent} />
          <path d="M31,7 C34.8,10 34.8,16 31,19" className={styles.glyphAccent} />
        </>
      );
    case "track":
    default:
      // The reply/activity loop returning to the run.
      return (
        <>
          <path d="M31,14 a9,9 0 1 1 -9,-9" className={styles.glyphStroke} />
          <path d="M18.5,2.4 L22.4,5 L18.7,7.8" className={styles.glyphStroke} />
          <circle cx={22} cy={14} r={2.3} className={styles.glyphReply} />
        </>
      );
  }
}

// ---------------------------------------------------------------------------
// Desktop/tablet command map. Everything decorative — hidden from AT.
// ---------------------------------------------------------------------------

function CommandMap() {
  return (
    <svg className={styles.commandMap} viewBox="0 0 760 640" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {/* Orbit ring behind the panels, with paced pulses circulating it. */}
      <circle className={styles.orbitRing} cx={CORE[0]} cy={CORE[1]} r={230} />
      <circle className={styles.orbitPulses} cx={CORE[0]} cy={CORE[1]} r={230} pathLength={100} />

      {/* Routing spokes: faint base + drawn-in active line per module. */}
      {PANELS.map((panel, index) => (
        <g key={`spoke-${panel.key}`}>
          <path className={styles.spokeBase} d={panel.spoke} />
          <path
            className={styles.spokeDraw}
            d={panel.spoke}
            pathLength={100}
            style={{ "--delay": `${0.28 + index * 0.05}s` } as CSSProperties}
          />
        </g>
      ))}

      {/* Controlled outbound + returning reply pulses. */}
      <path className={styles.sendPulse} d={SEND_PULSE_PATH} pathLength={100} />
      <path className={styles.replyPulse} d={REPLY_PULSE_PATH} pathLength={100} />

      {/* The Sendloom core powering on: halo, rotating dashed ring, hub with
          loom threads + envelope chevron (the product mark's own motifs). */}
      <g className={styles.core}>
        <circle className={styles.coreHalo} cx={CORE[0]} cy={CORE[1]} r={96} />
        <circle className={styles.coreDashRing} cx={CORE[0]} cy={CORE[1]} r={72} />
        <circle className={styles.coreRing} cx={CORE[0]} cy={CORE[1]} r={52} />
        <circle className={styles.corePulseRing} cx={CORE[0]} cy={CORE[1]} r={52} />
        <circle className={styles.coreHub} cx={CORE[0]} cy={CORE[1]} r={36} />
        <g transform={`translate(${CORE[0]}, ${CORE[1]})`}>
          <path d="M-11,-13 V13" className={styles.coreThreadFaint} />
          <path d="M0,-16 V16" className={styles.coreThread} />
          <path d="M11,-13 V13" className={styles.coreThreadFaint} />
          <path d="M-13,-4 L0,8 L13,-4" className={styles.coreChevron} />
        </g>
      </g>

      {/* Module panels docking into orbit. */}
      {COMMAND_MODULES.map((module, index) => {
        const panel = PANELS[index];
        const { x, y } = panel;
        return (
          <g
            key={module.key}
            className={styles.panel}
            style={
              {
                "--delay": `${0.12 + index * 0.07}s`,
                "--ex": `${panel.ex}px`,
                "--ey": `${panel.ey}px`
              } as CSSProperties
            }
          >
            <rect className={styles.panelBox} x={x} y={y} width={PANEL_W} height={PANEL_H} rx={14} />
            <circle className={styles.panelDot} cx={x + 19} cy={y + 21} r={3} />
            <text className={styles.panelLabel} x={x + 31} y={y + 25.5}>
              {module.label.toUpperCase()}
            </text>
            <text className={styles.panelIndex} x={x + PANEL_W - 15} y={y + 25.5}>
              {`0${index + 1}`}
            </text>
            <path className={styles.panelDivider} d={`M${x + 16},${y + 36} H${x + PANEL_W - 16}`} />
            <g transform={`translate(${x + 18}, ${y + 45})`}>
              <ModuleGlyph kind={module.key} />
            </g>
            <text className={styles.panelDetail} x={x + 66} y={y + 63}>
              {module.detail}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Mobile module flow — a separate vertical composition (not shrunken desktop):
// the six modules as compact docked rows on a live spine, with a send pulse
// travelling down and a reply pulse returning up.
// ---------------------------------------------------------------------------

function ModuleFlow() {
  return (
    <div className={styles.moduleFlow} aria-hidden="true">
      <span className={styles.flowSpine} />
      <span className={styles.flowPulse} />
      <span className={styles.flowReply} />
      {COMMAND_MODULES.map((module, index) => (
        <div key={module.key} className={styles.moduleRow} style={{ "--i": index } as CSSProperties}>
          <span className={styles.moduleChip}>
            <svg viewBox="0 0 36 28" className={styles.moduleChipGlyph}>
              <ModuleGlyph kind={module.key} />
            </svg>
          </span>
          <span className={styles.moduleText}>
            <span className={styles.moduleLabel}>{module.label.toUpperCase()}</span>
            <span className={styles.moduleDetail}>{module.detail}</span>
          </span>
          <span className={styles.moduleIndex}>{`0${index + 1}`}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The splash overlay.
// ---------------------------------------------------------------------------

export function StartupSplash() {
  const { phase, stage } = useStartupReadiness();

  if (phase === "done") {
    return null;
  }

  const stageLabel = SPLASH_STAGES[stage] ?? SPLASH_STAGES[0];

  return (
    <div
      className={styles.overlay}
      data-loader-overlay=""
      data-phase={phase}
      data-stage={stage}
      aria-busy={phase === "loading"}
    >
      {/* Layered command surface — all decorative, hidden from assistive tech. */}
      <div className={styles.backdrop} aria-hidden="true">
        <div className={styles.glow} />
        <div className={styles.grid} />
        <svg className={styles.fieldArcs} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <circle className={styles.fieldArc} cx={1030} cy={430} r={430} />
          <circle className={styles.fieldArcAlt} cx={1030} cy={430} r={560} />
        </svg>
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
                  "--peak": particle.peak
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className={styles.vignette} />
      </div>

      <div className={styles.scene}>
        {/* Brand block — asymmetric left column on desktop. */}
        <header className={styles.brandBlock}>
          <div className={styles.brandRow}>
            <span className={styles.brandLogo}>
              <SendloomLogo className={styles.brandLogoSvg} />
            </span>
            <span className={styles.brandTagline}>{BRAND_TAGLINE}</span>
          </div>
          <div className={styles.mark}>
            <span className={styles.markText}>
              <BrandText>{BRAND}</BrandText>
            </span>
            <span className={styles.markScan} aria-hidden="true" />
          </div>
          <div className={styles.specRule} aria-hidden="true" />
          <p className={styles.flowLine} aria-hidden="true">
            {COMMAND_MODULES.map((module) => (
              <span key={module.key} className={styles.flowStep}>
                {module.label}
              </span>
            ))}
          </p>
        </header>

        {/* Operations map (desktop/tablet) and its mobile counterpart. */}
        <div className={styles.mapZone} aria-hidden="true">
          <CommandMap />
        </div>
        <ModuleFlow />

        {/* Boot footer: phase ticks + one stage line + the controlled send rail. */}
        <footer className={styles.footer}>
          <div className={styles.phaseRail} aria-hidden="true">
            {SPLASH_STAGES.map((_, index) => (
              <span key={index} className={styles.phaseTick} data-active={index <= stage ? "" : undefined} />
            ))}
          </div>
          <p className={styles.stageCopy} role="status" aria-live="polite">
            {stageLabel}
            {/* Word-joiner glues the caret to the last word so it never wraps alone. */}
            <span className={styles.caretHold} aria-hidden="true">
              {"⁠"}
              <span className={styles.copyCaret} />
            </span>
          </p>
          <div className={styles.sendRail} aria-hidden="true">
            <span className={styles.railLine} />
            <span className={styles.railPulses} />
            <span className={styles.railReply} />
            <span className={styles.railCap} />
          </div>
        </footer>
      </div>

      <span className={styles.srOnly}>{SPLASH_STATUS_LABEL}</span>
    </div>
  );
}
