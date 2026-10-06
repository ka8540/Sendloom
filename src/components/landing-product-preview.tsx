"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import styles from "@/app/landing.module.css";

const PREVIEW_URL =
  "https://pub-9400568eaa014d6cbfd93f37668641cd.r2.dev/auth/ProductPage/Sequence-part.mp4";

export function LandingProductPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pausedByUser = useRef(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !reduceMotion.matches && !pausedByUser.current) {
          void video.play().catch(() => setPlaying(false));
        } else {
          video.pause();
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, []);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      pausedByUser.current = false;
      void video.play().catch(() => setPlaying(false));
    } else {
      pausedByUser.current = true;
      video.pause();
    }
  }

  return (
    <div className={styles.productPreview}>
      <div className={styles.productVideoFrame}>
        <video
          ref={videoRef}
          className={styles.productVideo}
          src={PREVIEW_URL}
          aria-label="Preview of building a Sendloom outreach sequence"
          muted
          playsInline
          loop
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        >
          Your browser does not support HTML video.
        </video>
      </div>
      <div className={styles.productMediaFooter}>
        <p>A look inside Sendloom</p>
        <button
          className={styles.productPlayButton}
          type="button"
          aria-label={playing ? "Pause product preview" : "Play product preview"}
          onClick={togglePlayback}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {playing ? "Pause" : "Play"} preview
        </button>
      </div>
    </div>
  );
}
