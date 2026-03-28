"use client";

import { useEffect, useRef } from "react";

import styles from "./animated-email-path.module.css";

const VIEWBOX_WIDTH = 1600;
const VIEWBOX_HEIGHT = 960;
const EMAIL_PATH =
  "M 246 682 C 362 652 470 590 544 498 C 618 406 640 266 582 178 C 526 92 370 112 342 240 C 314 372 434 458 586 454 C 764 450 936 398 1098 348 C 1248 302 1392 230 1542 132";
const CYCLE_DURATION_MS = 11800;
const SAMPLE_OFFSET = 6;

type MediaQueryListWithLegacy = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

const TRAVEL_KEYFRAMES = [
  { time: 0, value: 0 },
  { time: 0.2, value: 0.12 },
  { time: 0.42, value: 0.28 },
  { time: 0.64, value: 0.54 },
  { time: 0.82, value: 0.8 },
  { time: 1, value: 1 }
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function easeInOutCubic(value: number) {
  if (value < 0.5) {
    return 4 * value * value * value;
  }

  return 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function mapKeyframedProgress(value: number) {
  for (let index = 0; index < TRAVEL_KEYFRAMES.length - 1; index += 1) {
    const current = TRAVEL_KEYFRAMES[index];
    const next = TRAVEL_KEYFRAMES[index + 1];

    if (value >= current.time && value <= next.time) {
      const localProgress = (value - current.time) / (next.time - current.time || 1);
      const easedProgress = easeInOutCubic(localProgress);
      return current.value + (next.value - current.value) * easedProgress;
    }
  }

  return 1;
}

function fadeWindow(value: number, fadeInStart: number, fadeInEnd: number, fadeOutStart: number, fadeOutEnd: number) {
  if (value <= fadeInStart || value >= fadeOutEnd) {
    return 0;
  }

  if (value < fadeInEnd) {
    return clamp((value - fadeInStart) / (fadeInEnd - fadeInStart), 0, 1);
  }

  if (value > fadeOutStart) {
    return clamp((fadeOutEnd - value) / (fadeOutEnd - fadeOutStart), 0, 1);
  }

  return 1;
}

export function AnimatedEmailPath() {
  const motionPathRef = useRef<SVGPathElement>(null);
  const drawnPathRef = useRef<SVGPathElement>(null);
  const moverRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const motionPath = motionPathRef.current;
    const drawnPath = drawnPathRef.current;
    const mover = moverRef.current;

    if (!motionPath || !drawnPath || !mover) {
      return;
    }

    const totalLength = motionPath.getTotalLength();
    let frameId = 0;
    let startTime = performance.now();
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)") as MediaQueryListWithLegacy;

    const setMoverPosition = (progress: number, opacity: number) => {
      const targetLength = totalLength * progress;
      const point = motionPath.getPointAtLength(targetLength);
      const previousPoint = motionPath.getPointAtLength(Math.max(0, targetLength - SAMPLE_OFFSET));
      const nextPoint = motionPath.getPointAtLength(Math.min(totalLength, targetLength + SAMPLE_OFFSET));
      const angle = (Math.atan2(nextPoint.y - previousPoint.y, nextPoint.x - previousPoint.x) * 180) / Math.PI;

      mover.setAttribute(
        "transform",
        `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angle.toFixed(2)})`
      );
      mover.style.opacity = opacity.toFixed(3);
    };

    const renderStaticFrame = () => {
      drawnPath.setAttribute("stroke-dasharray", `${(totalLength * 0.84).toFixed(2)} ${totalLength.toFixed(2)}`);
      drawnPath.style.opacity = "0.28";
      setMoverPosition(0.86, 0.58);
    };

    const renderAnimatedFrame = (now: number) => {
      const cycleProgress = ((now - startTime) % CYCLE_DURATION_MS) / CYCLE_DURATION_MS;
      const drawProgress = clamp((cycleProgress - 0.02) / 0.72, 0, 1);
      const travelPhase = clamp((cycleProgress - 0.12) / 0.76, 0, 1);
      const easedTravel = mapKeyframedProgress(travelPhase);
      const drawVisibility = fadeWindow(cycleProgress, 0.02, 0.1, 0.9, 0.98);
      const moverVisibility = fadeWindow(cycleProgress, 0.12, 0.2, 0.88, 0.96);

      drawnPath.setAttribute("stroke-dasharray", `${Math.max(totalLength * drawProgress, 0.01).toFixed(2)} ${totalLength.toFixed(2)}`);
      drawnPath.style.opacity = (0.18 + drawVisibility * 0.42).toFixed(3);
      setMoverPosition(easedTravel, moverVisibility);

      frameId = window.requestAnimationFrame(renderAnimatedFrame);
    };

    const updateMotionPreference = () => {
      window.cancelAnimationFrame(frameId);

      if (reducedMotionQuery.matches) {
        renderStaticFrame();
        return;
      }

      startTime = performance.now();
      frameId = window.requestAnimationFrame(renderAnimatedFrame);
    };

    updateMotionPreference();

    if (typeof reducedMotionQuery.addEventListener === "function") {
      reducedMotionQuery.addEventListener("change", updateMotionPreference);
    } else if (typeof reducedMotionQuery.addListener === "function") {
      reducedMotionQuery.addListener(updateMotionPreference);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      if (typeof reducedMotionQuery.removeEventListener === "function") {
        reducedMotionQuery.removeEventListener("change", updateMotionPreference);
      } else if (typeof reducedMotionQuery.removeListener === "function") {
        reducedMotionQuery.removeListener(updateMotionPreference);
      }
    };
  }, []);

  return (
    <div aria-hidden="true" className={styles.root}>
      <div className={styles.canvas}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMid slice"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path ref={motionPathRef} className={styles.basePath} d={EMAIL_PATH} pathLength={1000} />
          <path ref={drawnPathRef} className={styles.activePath} d={EMAIL_PATH} pathLength={1000} />

          <g className={`${styles.icon} ${styles.staticEnvelope}`} transform="translate(212 628)">
            <rect x="-44" y="-30" width="88" height="60" rx="10" />
            <path d="M -44 -30 L 0 4 L 44 -30" />
            <path d="M -44 30 L -6 -2" />
            <path d="M 44 30 L 6 -2" />
          </g>

          <g ref={moverRef} className={styles.mover}>
            <g className={`${styles.icon} ${styles.plane}`}>
              <path d="M -56 19 L 58 0 L -56 -19 L -18 0 Z" />
              <path d="M -18 0 L -56 19" />
              <path d="M -18 0 L -56 -19" />
            </g>

            <g className={`${styles.icon} ${styles.payloadEnvelope}`} transform="translate(-4 -28)">
              <rect x="-18" y="-12" width="36" height="24" rx="4" />
              <path d="M -18 -12 L 0 2 L 18 -12" />
              <path d="M -18 12 L -4 -1" />
              <path d="M 18 12 L 4 -1" />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
