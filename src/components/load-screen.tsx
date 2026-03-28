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
          { yPercent: 28, opacity: 0, scale: 0.92, filter: "blur(12px)" },
          {
            yPercent: 0,
            opacity: 1,
            scale: 1,
            filter: "blur(0px)",
            duration: 0.82,
            ease: "expo.out",
            overwrite: "auto"
          }
        );
        gsap.fromTo(
          captionRef.current,
          { y: 24, opacity: 0, filter: "blur(10px)" },
          {
            y: 0,
            opacity: 1,
            filter: "blur(0px)",
            duration: 0.64,
            ease: "power3.out",
            overwrite: "auto"
          }
        );
        gsap.fromTo(
          eyebrowRef.current,
          { y: 14, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.48,
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
          { yPercent: 16, opacity: 0, scale: 0.95, filter: "blur(14px)" },
          {
            yPercent: 0,
            opacity: 1,
            scale: 1,
            filter: "blur(0px)",
            duration: 0.9,
            ease: "expo.out",
            overwrite: "auto"
          }
        );
        gsap.fromTo(
          captionRef.current,
          { y: 22, opacity: 0, letterSpacing: "0.4em" },
          {
            y: 0,
            opacity: 1,
            letterSpacing: "0.28em",
            duration: 0.62,
            ease: "power3.out",
            overwrite: "auto"
          }
        );
        gsap.fromTo(
          eyebrowRef.current,
          { y: 10, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.42,
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
          duration: 0.9,
          onUpdate: applyProgress
        })
        .call(() => swapToFinalMessage())
        .to({}, { duration: 0.8 })
        .to(overlay, {
          autoAlpha: 0,
          duration: 0.55,
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
        duration: 0.52,
        onUpdate: applyProgress
      })
      .to({}, { duration: 0.28 })
      .call(() => swapBeat(1))
      .to(
        progressState,
        {
          value: loaderBeats[1].progress,
          duration: 0.52,
          onUpdate: applyProgress
        },
        "<"
      )
      .to({}, { duration: 0.24 })
      .call(() => swapBeat(2))
      .to(
        progressState,
        {
          value: loaderBeats[2].progress,
          duration: 0.58,
          onUpdate: applyProgress
        },
        "<"
      )
      .to({}, { duration: 0.22 })
      .call(() => swapBeat(3))
      .to(
        progressState,
        {
          value: loaderBeats[3].progress,
          duration: 0.52,
          onUpdate: applyProgress
        },
        "<"
      )
      .to({}, { duration: 0.4 })
      .call(() => swapToFinalMessage())
      .to(
        progressState,
        {
          value: 100,
          duration: 0.62,
          onUpdate: applyProgress
        },
        "<0.08"
      )
      .to({}, { duration: 1.05 })
      .to(overlay, {
        clipPath: "inset(0% 0% 100% 0%)",
        duration: 1,
        ease: "expo.inOut"
      })
      .to(
        overlay,
        {
          autoAlpha: 0,
          duration: 0.18,
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

    const ambientLight = new THREE.AmbientLight(0xfff4ea, 1.18);
    const coralLight = new THREE.PointLight(0xff7c67, 26, 18, 2);
    coralLight.position.set(3.8, 2.1, 4.6);
    const mintLight = new THREE.PointLight(0x88ffd8, 20, 18, 2);
    mintLight.position.set(-3.5, -1.7, 4.9);
    const blueLight = new THREE.PointLight(0x63d6ff, 18, 18, 2);
    blueLight.position.set(-2.3, 2.8, 5.4);
    scene.add(ambientLight, coralLight, mintLight, blueLight);

    const coreMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xfff0e5,
      roughness: 0.16,
      metalness: 0.18,
      transmission: 0.28,
      thickness: 1.1,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      emissive: 0xff7859,
      emissiveIntensity: 0.2,
      transparent: true,
      opacity: 0.9
    });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.62, 2), coreMaterial);
    root.add(core);

    const knotMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff8f0,
      transparent: true,
      opacity: 0.22,
      wireframe: true
    });
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(2.42, 0.08, 220, 28, 2, 3), knotMaterial);
    root.add(knot);

    const orbitMaterial = new THREE.MeshBasicMaterial({
      color: 0x9cfde0,
      transparent: true,
      opacity: 0.48
    });
    const orbitA = new THREE.Mesh(new THREE.TorusGeometry(3.18, 0.025, 16, 180), orbitMaterial);
    orbitA.rotation.x = Math.PI / 2.2;
    orbitA.rotation.y = Math.PI / 5;
    const orbitB = orbitA.clone();
    orbitB.material = orbitMaterial.clone();
    (orbitB.material as THREE.MeshBasicMaterial).color.setHex(0xffefd9);
    (orbitB.material as THREE.MeshBasicMaterial).opacity = 0.26;
    orbitB.rotation.x = Math.PI / 1.78;
    orbitB.rotation.z = Math.PI / 3.8;
    root.add(orbitA, orbitB);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: 0xfff5eb,
        transparent: true,
        opacity: 0.14
      })
    );
    glow.scale.set(7.6, 7.6, 1);
    root.add(glow);

    const particleGeometry = new THREE.BufferGeometry();
    const particleCount = 760;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      const radius = 3.6 + Math.random() * 4.6;
      const theta = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 5.4;
      particlePositions[index * 3] = Math.cos(theta) * radius;
      particlePositions[index * 3 + 1] = y;
      particlePositions[index * 3 + 2] = Math.sin(theta) * radius * 0.78;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xfff7ef,
      size: 0.046,
      transparent: true,
      opacity: 0.78
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    root.add(particles);

    const trailGeometry = new THREE.BufferGeometry();
    const trailCount = 240;
    const trailPositions = new Float32Array(trailCount * 3);
    for (let index = 0; index < trailCount; index += 1) {
      const angle = (index / trailCount) * Math.PI * 2;
      const radius = 2.5 + Math.sin(index * 0.45) * 0.22;
      trailPositions[index * 3] = Math.cos(angle) * radius;
      trailPositions[index * 3 + 1] = Math.sin(index * 0.18) * 0.84;
      trailPositions[index * 3 + 2] = Math.sin(angle) * radius * 0.62;
    }
    trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
    const trails = new THREE.LineLoop(
      trailGeometry,
      new THREE.LineBasicMaterial({
        color: 0xffeddc,
        transparent: true,
        opacity: 0.28
      })
    );
    root.add(trails);

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
    resizeObserver.observe(mount);
    mount.addEventListener("pointermove", handlePointerMove);
    mount.addEventListener("pointerleave", handlePointerLeave);
    resize();

    const renderFrame = () => {
      const elapsed = clock.getElapsedTime();

      targetRotation.x += ((pointer.y * 0.18) - targetRotation.x) * 0.04;
      targetRotation.y += ((pointer.x * 0.24) - targetRotation.y) * 0.04;

      root.rotation.x = targetRotation.x + Math.sin(elapsed * 0.34) * 0.08;
      root.rotation.y = targetRotation.y + elapsed * 0.12;
      core.rotation.x = elapsed * 0.14;
      core.rotation.y = elapsed * 0.2;
      knot.rotation.x = elapsed * 0.09;
      knot.rotation.y = -elapsed * 0.13;
      orbitA.rotation.z = elapsed * 0.16;
      orbitB.rotation.y = -elapsed * 0.12;
      particles.rotation.y = -elapsed * 0.035;
      particles.rotation.x = Math.sin(elapsed * 0.12) * 0.08;
      trails.rotation.z = elapsed * 0.22;
      glow.material.opacity = 0.12 + Math.sin(elapsed * 1.2) * 0.03;

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
      mount.removeEventListener("pointermove", handlePointerMove);
      mount.removeEventListener("pointerleave", handlePointerLeave);
      mount.removeChild(renderer.domElement);

      core.geometry.dispose();
      coreMaterial.dispose();
      knot.geometry.dispose();
      knotMaterial.dispose();
      orbitA.geometry.dispose();
      (orbitA.material as THREE.Material).dispose();
      (orbitB.material as THREE.Material).dispose();
      (glow.material as THREE.Material).dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      trailGeometry.dispose();
      (trails.material as THREE.Material).dispose();
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
          <span className={styles.wordFill}>{headline}</span>
          <span className={styles.wordStroke} aria-hidden="true">
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
