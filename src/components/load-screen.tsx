"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import * as THREE from "three";

import styles from "@/components/load-screen.module.css";

const loaderBeats = [
  { word: "LOAD", caption: "Reading audience, sender, and sequence state.", progress: 18 },
  { word: "TUNE", caption: "Dialing motion, light, and launch cadence.", progress: 42 },
  { word: "SYNC", caption: "Aligning templates, signals, and controls.", progress: 73 },
  { word: "SEND", caption: "Priming the calm surface for the first frame.", progress: 92 }
] as const;

function formatPercent(value: number) {
  return String(Math.round(value)).padStart(3, "0");
}

function readThemeColor(variableName: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();

  return new THREE.Color(value || fallback);
}

export function LoadScreen() {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const eyebrowRef = useRef<HTMLParagraphElement | null>(null);
  const headlineRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLParagraphElement | null>(null);
  const meterFillRef = useRef<HTMLSpanElement | null>(null);
  const percentRef = useRef<HTMLSpanElement | null>(null);
  const [beatIndex, setBeatIndex] = useState(0);
  const [showFinalMessage, setShowFinalMessage] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!visible || !overlayRef.current || !headlineRef.current || !captionRef.current || !eyebrowRef.current) {
      return;
    }

    const overlay = overlayRef.current;
    const meterFill = meterFillRef.current;
    const percent = percentRef.current;
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const progressState = { value: loaderBeats[0].progress };

    const applyProgress = () => {
      if (meterFill) {
        meterFill.style.transform = `scaleX(${progressState.value / 100})`;
      }

      if (percent) {
        percent.textContent = formatPercent(progressState.value);
      }
    };

    const swapBeat = (index: number) => {
      startTransition(() => {
        setShowFinalMessage(false);
        setBeatIndex(index);
      });

      requestAnimationFrame(() => {
        if (!headlineRef.current || !captionRef.current || !eyebrowRef.current) {
          return;
        }

        gsap.fromTo(
          headlineRef.current,
          { yPercent: 18, opacity: 0, scale: 0.96, filter: "blur(8px)" },
          {
            yPercent: 0,
            opacity: 1,
            scale: 1,
            filter: "blur(0px)",
            duration: 1.18,
            ease: "power2.out",
            overwrite: "auto"
          }
        );
        gsap.fromTo(
          captionRef.current,
          { y: 18, opacity: 0, filter: "blur(8px)" },
          {
            y: 0,
            opacity: 1,
            filter: "blur(0px)",
            duration: 0.9,
            ease: "power2.out",
            overwrite: "auto"
          }
        );
        gsap.fromTo(
          eyebrowRef.current,
          { y: 10, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            ease: "power2.out",
            overwrite: "auto"
          }
        );
      });
    };

    const swapToFinalMessage = () => {
      startTransition(() => {
        setShowFinalMessage(true);
      });

      requestAnimationFrame(() => {
        if (!headlineRef.current || !captionRef.current || !eyebrowRef.current) {
          return;
        }

        gsap.fromTo(
          headlineRef.current,
          { yPercent: 12, opacity: 0, scale: 0.97, filter: "blur(9px)" },
          {
            yPercent: 0,
            opacity: 1,
            scale: 1,
            filter: "blur(0px)",
            duration: 1.28,
            ease: "power2.out",
            overwrite: "auto"
          }
        );
        gsap.fromTo(
          captionRef.current,
          { y: 18, opacity: 0, letterSpacing: "0.28em" },
          {
            y: 0,
            opacity: 1,
            letterSpacing: "0.18em",
            duration: 0.96,
            ease: "power2.out",
            overwrite: "auto"
          }
        );
        gsap.fromTo(
          eyebrowRef.current,
          { y: 8, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.72,
            ease: "power2.out",
            overwrite: "auto"
          }
        );
      });
    };

    applyProgress();
    gsap.set(overlay, { autoAlpha: 1, clipPath: "inset(0% 0% 0% 0%)" });

    if (reducedMotionQuery.matches) {
      const reducedTimeline = gsap.timeline({
        defaults: {
          ease: "power2.out"
        }
      });

      swapBeat(0);

      reducedTimeline
        .to(progressState, {
          value: 100,
          duration: 1.25,
          onUpdate: applyProgress
        })
        .call(() => swapToFinalMessage())
        .to({}, { duration: 1.1 })
        .to(overlay, {
          autoAlpha: 0,
          duration: 0.7,
          ease: "power2.inOut"
        })
        .call(() => setVisible(false));

      return () => {
        reducedTimeline.kill();
      };
    }

    const timeline = gsap.timeline({
      defaults: {
        ease: "power3.out"
      }
    });

    swapBeat(0);

    timeline
      .to(progressState, {
        value: loaderBeats[0].progress,
        duration: 0.8,
        onUpdate: applyProgress
      })
      .to({}, { duration: 0.56 })
      .call(() => swapBeat(1))
      .to(
        progressState,
        {
          value: loaderBeats[1].progress,
          duration: 0.84,
          onUpdate: applyProgress
        },
        "<"
      )
      .to({}, { duration: 0.52 })
      .call(() => swapBeat(2))
      .to(
        progressState,
        {
          value: loaderBeats[2].progress,
          duration: 0.9,
          onUpdate: applyProgress
        },
        "<"
      )
      .to({}, { duration: 0.5 })
      .call(() => swapBeat(3))
      .to(
        progressState,
        {
          value: loaderBeats[3].progress,
          duration: 0.84,
          onUpdate: applyProgress
        },
        "<"
      )
      .to({}, { duration: 0.72 })
      .call(() => swapToFinalMessage())
      .to(
        progressState,
        {
          value: 100,
          duration: 0.96,
          onUpdate: applyProgress
        },
        "<0.16"
      )
      .to({}, { duration: 1.45 })
      .to(overlay, {
        clipPath: "inset(0% 0% 100% 0%)",
        duration: 1.16,
        ease: "power3.inOut"
      })
      .to(
        overlay,
        {
          autoAlpha: 0,
          duration: 0.28,
          ease: "power1.out"
        },
        "<0.74"
      )
      .call(() => setVisible(false));

    return () => {
      timeline.kill();
    };
  }, [visible]);

  useEffect(() => {
    const mount = sceneRef.current;
    if (!mount || !visible) {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
    camera.position.set(0, 0.12, 8.8);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    scene.add(ambientLight);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x9cfde0,
      transparent: true,
      opacity: 0.16,
      wireframe: true
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.12, 0.22, 18, 240), ringMaterial);
    ring.rotation.x = Math.PI / 2.16;
    ring.rotation.y = Math.PI / 5.6;
    ring.position.x = -0.75;
    root.add(ring);

    const arcCurve = new THREE.EllipseCurve(0, 0, 3.5, 2.2, Math.PI * 0.18, Math.PI * 1.12, false, 0);
    const arcPoints = arcCurve.getPoints(220).map((point) => new THREE.Vector3(point.x, point.y * 0.82, -1.2));
    const arcGeometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const arcMaterial = new THREE.LineBasicMaterial({
      color: 0x8bdcb9,
      transparent: true,
      opacity: 0.18
    });
    const arc = new THREE.Line(arcGeometry, arcMaterial);
    arc.rotation.z = -0.32;
    arc.position.set(0.35, -0.4, 0);
    root.add(arc);

    const particleGeometry = new THREE.BufferGeometry();
    const particleCount = 420;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      const radius = 4.4 + Math.random() * 4.2;
      const theta = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 5.6;
      particlePositions[index * 3] = Math.cos(theta) * radius;
      particlePositions[index * 3 + 1] = y;
      particlePositions[index * 3 + 2] = Math.sin(theta) * radius * 0.72;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xfff7ef,
      size: 0.038,
      transparent: true,
      opacity: 0.52
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    root.add(particles);

    const pointer = new THREE.Vector2(0, 0);
    const targetRotation = new THREE.Vector2(0, 0);
    const clock = new THREE.Clock();

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    };

    const handlePointerLeave = () => {
      pointer.set(0, 0);
    };

    const resizeObserver = new ResizeObserver(resize);
    const themeObserver = new MutationObserver(applyPalette);
    const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function applyPalette() {
      ambientLight.color.copy(readThemeColor("--loader-scene-core", "#ffffff"));
      ringMaterial.color.copy(readThemeColor("--loader-scene-orbit", "#167c5a"));
      arcMaterial.color.copy(readThemeColor("--loader-scene-trail", "#8bdcb9"));
      particleMaterial.color.copy(readThemeColor("--loader-scene-particles", "#8fb1eb"));
    }

    resizeObserver.observe(mount);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"]
    });
    systemThemeQuery.addEventListener("change", applyPalette);
    mount.addEventListener("pointermove", handlePointerMove);
    mount.addEventListener("pointerleave", handlePointerLeave);
    applyPalette();
    resize();

    const renderFrame = () => {
      const elapsed = clock.getElapsedTime();

      targetRotation.x += ((pointer.y * 0.18) - targetRotation.x) * 0.04;
      targetRotation.y += ((pointer.x * 0.24) - targetRotation.y) * 0.04;

      root.rotation.x = targetRotation.x + Math.sin(elapsed * 0.34) * 0.08;
      root.rotation.y = targetRotation.y + elapsed * 0.12;
      ring.rotation.z = elapsed * 0.16;
      ring.rotation.y += Math.sin(elapsed * 0.18) * 0.0008;
      arc.rotation.z = -0.32 + Math.sin(elapsed * 0.34) * 0.06;
      particles.rotation.y = -elapsed * 0.035;
      particles.rotation.x = Math.sin(elapsed * 0.12) * 0.08;

      renderer.render(scene, camera);
    };

    if (reducedMotion) {
      renderFrame();
    } else {
      renderer.setAnimationLoop(renderFrame);
    }

    return () => {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      systemThemeQuery.removeEventListener("change", applyPalette);
      mount.removeEventListener("pointermove", handlePointerMove);
      mount.removeEventListener("pointerleave", handlePointerLeave);
      mount.removeChild(renderer.domElement);

      ring.geometry.dispose();
      ringMaterial.dispose();
      arcGeometry.dispose();
      arcMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      renderer.dispose();
    };
  }, [visible]);

  if (!visible) {
    return null;
  }

  const activeBeat = loaderBeats[beatIndex];
  const eyebrow = showFinalMessage ? "Sequence surface ready" : "Loading Sendloom";
  const headline = showFinalMessage ? "WELCOME" : activeBeat.word;
  const caption = showFinalMessage ? "TO SENDLOOM" : activeBeat.caption;

  return (
    <div ref={overlayRef} className={styles.loader}>
      <div ref={sceneRef} className={styles.scene} aria-hidden="true" />
      <div className={styles.texture} aria-hidden="true" />

      <div className={styles.content} aria-live="polite">
        <p ref={eyebrowRef} className={styles.eyebrow}>
          {eyebrow}
        </p>

        <div ref={headlineRef} className={styles.headline} data-final={showFinalMessage ? "true" : "false"}>
          <span className={styles.word} data-text={headline}>
            {headline}
          </span>
        </div>

        <p ref={captionRef} className={styles.caption} data-final={showFinalMessage ? "true" : "false"}>
          {caption}
        </p>

        <div className={styles.footer}>
          <div className={styles.meter} aria-hidden="true">
            <span ref={meterFillRef} className={styles.meterFill} />
          </div>
          <span ref={percentRef} className={styles.percent}>
            {formatPercent(loaderBeats[0].progress)}
          </span>
        </div>
      </div>
    </div>
  );
}
