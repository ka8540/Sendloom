import { useId } from "react";

type SendloomLogoProps = {
  className?: string;
};

export function SendloomLogo({ className }: SendloomLogoProps) {
  const id = useId();
  const gradientId = `${id}-gradient`;
  const glowId = `${id}-glow`;

  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="Sendloom"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#23A774" />
          <stop offset="1" stopColor="#167C5A" />
        </linearGradient>
        <radialGradient id={glowId} cx="0" cy="0" r="1" gradientTransform="translate(16 14) rotate(42) scale(26 26)" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.22" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="2" y="2" width="44" height="44" rx="16" fill={`url(#${gradientId})`} />
      <rect x="2" y="2" width="44" height="44" rx="16" fill={`url(#${glowId})`} />
      <path d="M16.5 12.5v23" stroke="rgba(255,255,255,0.34)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M24 11.5v25" stroke="rgba(255,255,255,0.48)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M31.5 12.5v23" stroke="rgba(255,255,255,0.34)" strokeWidth="2.2" strokeLinecap="round" />
      <path
        d="M13 18.4c0-2.43 1.97-4.4 4.4-4.4h13.2c2.43 0 4.4 1.97 4.4 4.4v11.2c0 2.43-1.97 4.4-4.4 4.4H17.4c-2.43 0-4.4-1.97-4.4-4.4V18.4Z"
        fill="rgba(255,255,255,0.14)"
        stroke="rgba(255,255,255,0.96)"
        strokeWidth="2.2"
      />
      <path
        d="M14.9 18.2 24 24.5l9.1-6.3"
        fill="none"
        stroke="rgba(255,255,255,0.96)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M27.8 16.2 36.3 12.6l-4.1 8.7"
        fill="none"
        stroke="white"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
