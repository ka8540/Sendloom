"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import styles from "@/app/auth.module.css";
import { SendloomLogo } from "@/components/sendloom-logo";

type VideoPhase = "loading" | "intro" | "playing" | "outro";

const INTRO_DURATION_MS = 1250;
const OUTRO_DURATION_MS = 760;

export function AuthVideoPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const hasStartedRef = useRef(false);
  const soundEnabledRef = useRef(false);
  const [phase, setPhase] = useState<VideoPhase>("loading");
  const [soundEnabled, setSoundEnabled] = useState(false);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) {
      window.clearTimeout(timer);
    }

    timersRef.current = [];
  }, []);

  const startSequence = useCallback(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    clearTimers();
    setPhase("intro");

    video.pause();
    video.currentTime = 0;
    video.muted = !soundEnabledRef.current;
    video.volume = soundEnabledRef.current ? 1 : 0;

    const playTimer = window.setTimeout(async () => {
      setPhase("playing");

      try {
        await video.play();
      } catch {
        if (soundEnabledRef.current) {
          soundEnabledRef.current = false;
          setSoundEnabled(false);
          video.muted = true;
          video.volume = 0;
          await video.play().catch(() => {});
        }
      }
    }, INTRO_DURATION_MS);

    timersRef.current.push(playTimer);
  }, [clearTimers]);

  const handleReady = useCallback(() => {
    if (hasStartedRef.current) {
      return;
    }

    hasStartedRef.current = true;
    startSequence();
  }, [startSequence]);

  const handleEnded = useCallback(() => {
    setPhase("outro");

    const restartTimer = window.setTimeout(() => {
      startSequence();
    }, OUTRO_DURATION_MS);

    timersRef.current.push(restartTimer);
  }, [startSequence]);

  const handleSoundToggle = useCallback(() => {
    const nextSoundEnabled = !soundEnabledRef.current;
    const video = videoRef.current;

    soundEnabledRef.current = nextSoundEnabled;
    setSoundEnabled(nextSoundEnabled);

    if (!video) {
      return;
    }

    if (!nextSoundEnabled) {
      video.muted = true;
      video.volume = 0;
      return;
    }

    video.muted = false;
    video.volume = 1;
    void video.play().catch(() => {});
  }, []);

  useEffect(() => {
    const video = videoRef.current;

    if (video?.readyState && !hasStartedRef.current) {
      handleReady();
    }

    return () => {
      clearTimers();
    };
  }, [clearTimers, handleReady]);

  const viewportClassName = [
    styles.videoViewport,
    phase === "loading" ? styles.videoViewportLoading : "",
    phase === "intro" ? styles.videoViewportIntro : "",
    phase === "playing" ? styles.videoViewportPlaying : "",
    phase === "outro" ? styles.videoViewportOutro : ""
  ]
    .filter(Boolean)
    .join(" ");

  const videoClassName = [
    styles.videoElement,
    phase === "playing" ? styles.videoElementPlaying : "",
    phase === "outro" ? styles.videoElementOutro : ""
  ]
    .filter(Boolean)
    .join(" ");

  const veilClassName = [
    styles.videoVeil,
    phase === "playing" ? styles.videoVeilPlaying : "",
    phase === "outro" ? styles.videoVeilOutro : ""
  ]
    .filter(Boolean)
    .join(" ");

  const sweepClassName = [
    styles.videoSweep,
    phase === "intro" ? styles.videoSweepIntro : "",
    phase === "outro" ? styles.videoSweepOutro : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.previewWindow}>
      <div className={styles.previewChrome}>
        <div className={styles.chromeDots} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className={styles.previewBrand}>
          <SendloomLogo className={styles.previewBrandMark} />
          <span>Sendloom</span>
        </div>
      </div>

      <div className={viewportClassName}>
        <div className={styles.videoBackdrop} aria-hidden="true" />

        <video
          ref={videoRef}
          className={videoClassName}
          muted
          playsInline
          preload="auto"
          src="/videos/sendloom-auth-preview.mp4"
          onCanPlay={handleReady}
          onEnded={handleEnded}
        />

        <div className={veilClassName} aria-hidden="true" />
        <div className={sweepClassName} aria-hidden="true" />
        <div className={styles.videoGlow} aria-hidden="true" />
        <span className={`${styles.videoCorner} ${styles.videoCornerTop}`} aria-hidden="true" />
        <span className={`${styles.videoCorner} ${styles.videoCornerBottom}`} aria-hidden="true" />

        <button
          className={`${styles.videoAudioButton} ${soundEnabled ? styles.videoAudioButtonOn : styles.videoAudioButtonOff}`}
          type="button"
          aria-label={soundEnabled ? "Mute preview audio" : "Unmute preview audio"}
          onClick={handleSoundToggle}
        >
          {soundEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
