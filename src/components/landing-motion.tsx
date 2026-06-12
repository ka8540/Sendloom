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
          /* Cards sharing a row cross the trigger line together; a small
             sibling-order delay turns that into a cascade. */
          const parent = element.parentElement;
          let order = 0;
          if (parent) {
            const peers = Array.from(parent.children).filter((child) => child.hasAttribute("data-reveal"));
            if (peers.length > 1) {
              order = peers.indexOf(element);
            }
          }

          gsap.set(element, { opacity: 0, y: 30 });
          gsap.to(element, {
            opacity: 1,
            y: 0,
            duration: 0.85,
            delay: Math.min(order * 0.09, 0.45),
            ease: "power2.out",
            // Drop the leftover inline transform once revealed so CSS :hover
            // transitions (e.g. the feature-card lift) aren't blocked by GSAP's
            // inline style. Visually identical — the element ends at y: 0.
            clearProps: "transform",
            // CSS-side draw animations (check marks, the health ring) key off
            // this attribute instead of duplicating the trigger logic.
            onStart: () => element.setAttribute("data-revealed", ""),
            scrollTrigger: {
              trigger: element,
              start: "top 88%",
              once: true
            }
          });
        });

        const chaosCards = gsap.utils.toArray<HTMLElement>("[data-chaos]");
        if (chaosCards.length > 0) {
          chaosCards.forEach((card, index) => {
            const direction = index % 2 === 0 ? -1 : 1;
            gsap.from(card, {
              x: direction * (20 + ((index * 9) % 26)),
              y: 48,
              rotation: direction * (7 + ((index * 5) % 7)),
              opacity: 0,
              duration: 0.8,
              delay: index * 0.07,
              ease: "power3.out",
              clearProps: "transform,opacity",
              scrollTrigger: {
                trigger: card.parentElement ?? card,
                start: "top 85%",
                once: true
              }
            });
          });
        }

        const line = document.querySelector<SVGPathElement>("[data-workflow-line]");
        const track = document.querySelector<HTMLElement>("[data-workflow]");
        if (line && track) {
          /* Steps render lit for no-JS/reduced-motion; once motion is
             confirmed they go dark and light up as the thread passes. */
          const steps = gsap.utils.toArray<HTMLElement>("[data-step]", track);
          steps.forEach((step) => step.removeAttribute("data-active"));

          gsap.set(line, { strokeDasharray: 1000, strokeDashoffset: 1000 });
          gsap.to(line, {
            strokeDashoffset: 0,
            ease: "none",
            scrollTrigger: {
              trigger: track,
              start: "top 78%",
              end: "bottom 62%",
              scrub: 0.6,
              onUpdate: (self) => {
                const lit = Math.ceil(self.progress * steps.length);
                steps.forEach((step, index) => {
                  if (index < lit) {
                    step.setAttribute("data-active", "true");
                  } else {
                    step.removeAttribute("data-active");
                  }
                });
              }
            }
          });

          /* A glowing packet rides the thread while the section is on
             screen. Driven via getPointAtLength in viewBox coordinates, so
             it stays exact under the rail's non-uniform scaling. The rail is
             display:none below 1100px — skip the loop entirely there. */
          const packet = track.querySelector<SVGGElement>("[data-workflow-packet]");
          const rail = line.closest("svg");
          if (packet && rail && window.getComputedStyle(rail).display !== "none") {
            const totalLength = line.getTotalLength();
            const proxy = { progress: 0 };
            gsap.set(packet, { opacity: 1 });
            gsap.to(proxy, {
              progress: 1,
              duration: 7.5,
              repeat: -1,
              repeatDelay: 0.8,
              ease: "power1.inOut",
              onUpdate: () => {
                const point = line.getPointAtLength(proxy.progress * totalLength);
                packet.setAttribute("transform", `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`);
              },
              scrollTrigger: {
                trigger: track,
                start: "top 95%",
                end: "bottom top",
                toggleActions: "play pause resume pause"
              }
            });
          }
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
