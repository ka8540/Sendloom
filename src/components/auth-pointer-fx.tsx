"use client";

import { useEffect, useRef } from "react";

import styles from "@/app/auth.module.css";

/**
 * Pointer-driven atmosphere for the auth pages, mirroring the landing scene:
 * - a soft cursor-following spotlight behind the split layout
 * - tilt + spotlight CSS variables on `[data-card-fx]` surfaces (the form card)
 * - gentle pointer parallax on `[data-parallax]` elements (the showcase column)
 *
 * Transform/opacity only. A shared rAF loop runs while values are settling and
 * stops once the scene is at rest, so an idle pointer costs nothing. Disabled
 * entirely for coarse pointers and `prefers-reduced-motion: reduce`, and every
 * listener is torn down on unmount so navigating away leaks nothing.
 */
export function AuthPointerFX() {
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (!finePointer.matches || reduceMotion.matches) {
      return;
    }

    const glow = glowRef.current;

    let targetX = window.innerWidth * 0.5;
    let targetY = window.innerHeight * 0.4;
    let glowX = targetX;
    let glowY = targetY;
    let parallaxTargetX = 0;
    let parallaxTargetY = 0;
    let parallaxX = 0;
    let parallaxY = 0;
    let frame = 0;
    let settled = true;
    let glowVisible = false;

    const parallaxItems = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]")).map((element) => ({
      element,
      depth: Number(element.dataset.parallax) || 8
    }));

    const step = () => {
      glowX += (targetX - glowX) * 0.12;
      glowY += (targetY - glowY) * 0.12;
      parallaxX += (parallaxTargetX - parallaxX) * 0.05;
      parallaxY += (parallaxTargetY - parallaxY) * 0.05;

      if (glow) {
        glow.style.transform = `translate3d(${(glowX - 320).toFixed(1)}px, ${(glowY - 320).toFixed(1)}px, 0)`;
        if (!glowVisible) {
          glow.style.opacity = "1";
          glowVisible = true;
        }
      }

      for (const item of parallaxItems) {
        item.element.style.transform = `translate3d(${(parallaxX * item.depth).toFixed(2)}px, ${(parallaxY * item.depth).toFixed(2)}px, 0)`;
      }

      const atRest =
        Math.abs(targetX - glowX) < 0.3 &&
        Math.abs(targetY - glowY) < 0.3 &&
        Math.abs(parallaxTargetX - parallaxX) < 0.001 &&
        Math.abs(parallaxTargetY - parallaxY) < 0.001;

      if (atRest) {
        settled = true;
        return;
      }

      frame = window.requestAnimationFrame(step);
    };

    const onPointerMove = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      parallaxTargetX = event.clientX / window.innerWidth - 0.5;
      parallaxTargetY = event.clientY / window.innerHeight - 0.5;

      if (settled) {
        settled = false;
        frame = window.requestAnimationFrame(step);
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-card-fx]"));
    const cardCleanups = cards.map((card) => {
      let cardFrame = 0;

      const onMove = (event: PointerEvent) => {
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        window.cancelAnimationFrame(cardFrame);
        cardFrame = window.requestAnimationFrame(() => {
          card.style.setProperty("--spot-x", `${x.toFixed(1)}px`);
          card.style.setProperty("--spot-y", `${y.toFixed(1)}px`);
          card.style.setProperty("--tilt-x", `${((y / rect.height - 0.5) * -2.4).toFixed(2)}deg`);
          card.style.setProperty("--tilt-y", `${((x / rect.width - 0.5) * 3).toFixed(2)}deg`);
          card.style.setProperty("--spot-opacity", "1");
        });
      };

      const onLeave = () => {
        window.cancelAnimationFrame(cardFrame);
        card.style.setProperty("--tilt-x", "0deg");
        card.style.setProperty("--tilt-y", "0deg");
        card.style.setProperty("--spot-opacity", "0");
      };

      card.addEventListener("pointermove", onMove, { passive: true });
      card.addEventListener("pointerleave", onLeave);

      return () => {
        window.cancelAnimationFrame(cardFrame);
        card.removeEventListener("pointermove", onMove);
        card.removeEventListener("pointerleave", onLeave);
      };
    });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.cancelAnimationFrame(frame);
      cardCleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  return <div ref={glowRef} className={styles.cursorGlow} aria-hidden="true" />;
}
