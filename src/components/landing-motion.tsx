"use client";

import { useEffect } from "react";

/**
 * Drives the landing page scroll choreography with GSAP + ScrollTrigger.
 *
 * Progressive enhancement: every animated element renders fully visible from the
 * server. This component only hides-then-reveals elements once it has confirmed
 * motion is allowed, so content is never trapped behind an animation for users
 * with JavaScript disabled or `prefers-reduced-motion: reduce` set.
 */
export function LandingMotion() {
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMotion.matches) {
      return;
    }

    let revert: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger")
      ]);

      if (cancelled) {
        return;
      }

      gsap.registerPlugin(ScrollTrigger);

      const context = gsap.context(() => {
        const words = gsap.utils.toArray<HTMLElement>("[data-hero-word]");
        if (words.length > 0) {
          gsap.set(words, { yPercent: 120, opacity: 0 });
          gsap.to(words, {
            yPercent: 0,
            opacity: 1,
            duration: 0.9,
            ease: "power3.out",
            stagger: 0.08,
            delay: 0.08
          });
        }

        const reveals = gsap.utils.toArray<HTMLElement>("[data-reveal]");
        reveals.forEach((element) => {
          gsap.set(element, { opacity: 0, y: 30 });
          gsap.to(element, {
            opacity: 1,
            y: 0,
            duration: 0.85,
            ease: "power2.out",
            scrollTrigger: {
              trigger: element,
              start: "top 88%",
              once: true
            }
          });
        });

        const line = document.querySelector<SVGPathElement>("[data-workflow-line]");
        const track = document.querySelector<HTMLElement>("[data-workflow]");
        if (line && track) {
          gsap.set(line, { strokeDasharray: 1000, strokeDashoffset: 1000 });
          gsap.to(line, {
            strokeDashoffset: 0,
            ease: "none",
            scrollTrigger: {
              trigger: track,
              start: "top 78%",
              end: "bottom 62%",
              scrub: 0.6
            }
          });
        }
      });

      ScrollTrigger.refresh();

      revert = () => context.revert();
    })();

    return () => {
      cancelled = true;
      revert?.();
    };
  }, []);

  return null;
}
