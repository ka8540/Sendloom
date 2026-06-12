import { Activity, FileText, Mail, Search, Upload, Workflow } from "lucide-react";

import styles from "@/app/landing.module.css";

const flowNodes = [
  { icon: Upload, label: "Leads imported", meta: "CSV & XLSX mapped" },
  { icon: Search, label: "Contacts enriched", meta: "hunter.io lookups" },
  { icon: FileText, label: "Template ready", meta: "HTML · merge vars" },
  { icon: Workflow, label: "Sequence built", meta: "sender + window set" },
  { icon: Mail, label: "Sent via Gmail", meta: "connected sender" },
  { icon: Activity, label: "Run tracked", meta: "opens · replies · retries" }
] as const;

export function LandingHeroFlow() {
  return (
    <div className={styles.heroStage}>
      <div className={styles.heroOrbit} aria-hidden="true" data-pointer-parallax="-10">
        <span className={styles.orbitRing} />
        <span className={styles.orbitRingInner} />
        <span className={styles.orbitTrack}>
          <span className={styles.orbitSatellite}>
            <span className={styles.orbitEnvelope}>
              <Mail strokeWidth={1.8} />
            </span>
          </span>
        </span>
        <span className={styles.orbitTrackInner}>
          <span className={styles.orbitDot} />
        </span>
      </div>

      <div className={styles.heroPanel}>
        <span className={styles.heroPanelGlow} aria-hidden="true" />
        <div className={styles.heroPanelBar}>
          <span className={styles.heroPanelDots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className={styles.heroPanelTitle}>command center</span>
          <span className={styles.heroLiveTag}>
            <span className={styles.heroLiveDot} aria-hidden="true" />
            live
          </span>
        </div>

        <div className={styles.heroFlow}>
          <span className={styles.heroFlowSpine} aria-hidden="true">
            <span className={styles.heroFlowPulse} />
          </span>

          <ul className={styles.heroNodes}>
            {flowNodes.map((node) => {
              const Icon = node.icon;
              return (
                <li key={node.label} className={styles.heroNode}>
                  <span className={styles.heroNodeIcon} aria-hidden="true">
                    <Icon strokeWidth={1.8} />
                  </span>
                  <span className={styles.heroNodeText}>
                    <strong>{node.label}</strong>
                    <span>{node.meta}</span>
                  </span>
                  <span className={styles.heroNodeState} aria-hidden="true" />
                </li>
              );
            })}
          </ul>
        </div>

        <div className={styles.heroPanelFooter} aria-hidden="true">
          <span className={styles.heroPanelFooterDot} />
          <span>Run paced · follow-ups scheduled</span>
          <span className={styles.heroCaret} />
        </div>
      </div>

      <div className={`${styles.heroChipWrap} ${styles.heroChipWrapTop}`} data-pointer-parallax="18" aria-hidden="true">
        <aside className={`${styles.heroChip} ${styles.heroChipTop}`}>
          <span className={styles.heroChipLabel}>Template</span>
          <strong className={styles.heroChipValue}>Plain text · HTML · JSON</strong>
          <span className={styles.heroChipMeta}>Previewed as a real email</span>
        </aside>
      </div>

      <div className={`${styles.heroChipWrap} ${styles.heroChipWrapBottom}`} data-pointer-parallax="12" aria-hidden="true">
        <aside className={`${styles.heroChip} ${styles.heroChipBottom}`}>
          <span className={styles.heroChipLabel}>Delivery</span>
          <strong className={styles.heroChipValue}>Opens · replies · retries</strong>
          <span className={styles.heroChipMeta}>Attached to the campaign</span>
        </aside>
      </div>
    </div>
  );
}
