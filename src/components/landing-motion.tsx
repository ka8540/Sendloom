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

      /*
       * Data chapter scrollytelling.
       *
       * Scroll position is the only source of truth: one ScrollTrigger maps
       * section progress onto the three-card deck, so the animation is
       * inherently reversible and never timer-based. Card motion is scrubbed
       * (applied verbatim from progress); the staggered reveals inside each
       * card are plain CSS transitions gated by [data-active].
       *
       * The whole effect is desktop-only. gsap.matchMedia reverts everything
       * — inline styles, the trigger, and the `data-story="enhanced"`
       * attribute that arms the sticky grid — below 1024px, where the same
       * DOM falls back to a plain stacked section.
       */
      const story = document.querySelector<HTMLElement>("[data-story]");
      const media = gsap.matchMedia();
      if (story) {
        media.add("(min-width: 1024px)", () => {
          story.setAttribute("data-story", "enhanced");

          const cards = gsap.utils.toArray<HTMLElement>("[data-story-card]", story);
          const steps = gsap.utils.toArray<HTMLElement>("[data-story-step]", story);
          const fills = gsap.utils.toArray<HTMLElement>("[data-story-fill]", story);
          const count = cards.length;
          let activeIndex = -1;

          /*
           * Persistent deck. Every card always occupies a slot and stays
           * visible — no state, at any scroll position, has opacity below
           * 0.5, so fast scrolling can never produce an empty stage:
           *
           *   seated    front, fully opaque
           *   waiting   stacked below the active card, peeking out
           *   passed    settled just above/behind, subdued but present
           *
           * x measures distance from the card's seat in story steps
           * (x = 0 … seated, x = -1 … next slot down, x = +1 … dealt).
           */
          const apply = (progress: number) => {
            cards.forEach((card, i) => {
              const x = progress * count - (i + 0.28);
              let y = 0;
              let rotation = 0;
              let scale = 1;
              let opacity = 1;
              if (x < -0.5) {
                /* Waiting in the deck below: slot 1 peeks, slot 2 sits deeper. */
                const t = Math.min(-x - 0.5, 2);
                y = Math.min(t * 26, 26);
                rotation = Math.min(t * 1.2, 1.5);
                scale = 1 - Math.min(t * 0.05, 0.05);
                opacity = 1 - Math.min(t * 0.45, 0.5);
              } else if (x > 0.15) {
                /* Dealt: lifts slightly and settles above, never blinks out. */
                const t = Math.min((x - 0.15) / 0.5, 2);
                y = -Math.min(t * 14, 18);
                rotation = -Math.min(t * 1.2, 1.5);
                scale = 1 - Math.min(t * 0.03, 0.05);
                opacity = 1 - Math.min(t * 0.3, 0.6);
              }
              gsap.set(card, { y, rotation, scale, opacity, zIndex: Math.round(100 - Math.abs(x) * 20) });
            });

            /* Discrete active story: text is driven by this alone, never by
               transition opacity, so it cannot all be zero at once. A fast
               flick lands directly on the final state — no queue, no wait. */
            const index = progress < 0.3 ? 0 : progress < 0.67 ? 1 : 2;
            if (index !== activeIndex) {
              activeIndex = index;
              steps.forEach((step, i) => step.toggleAttribute("data-active", i === index));
              cards.forEach((card, i) => card.toggleAttribute("data-active", i === index));
              fills.forEach((fill, i) => fill.parentElement?.toggleAttribute("data-active", i === index));
            }

            fills.forEach((fill, i) => {
              gsap.set(fill, { scaleX: Math.min(Math.max(progress * count - i, 0), 1) });
            });
          };

          apply(0);

          ScrollTrigger.create({
            trigger: story,
            /* Matches the stage's sticky top offset (min 6.5rem). */
            start: "top top+=104",
            end: "bottom bottom-=40",
            onUpdate: (self) => apply(self.progress),
            onRefresh: (self) => apply(self.progress)
          });

          return () => {
            story.removeAttribute("data-story");
          };
        });
      }

      ScrollTrigger.refresh();

      revert = () => {
        media.revert();
        context.revert();
      };
    })();

    return () => {
      cancelled = true;
      revert?.();
    };
  }, []);

  return null;
}
