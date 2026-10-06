import styles from "./page.module.css";

type ProductDemoVideoProps = {
  src: string;
  title: string;
  hero?: boolean;
};

export function ProductDemoVideo({ src, title, hero = false }: ProductDemoVideoProps) {
  return (
    <div className={styles.videoFrame}>
      <video
        className={styles.video}
        src={src}
        aria-label={title}
        controls
        playsInline
        preload="metadata"
        autoPlay={hero}
        muted={hero}
        loop={hero}
      >
        Your browser does not support HTML video.
      </video>
    </div>
  );
}
