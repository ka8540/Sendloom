import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #29c08a, #167c5a)",
          borderRadius: 44,
          position: "relative",
          overflow: "hidden",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.24)"
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(circle at 28% 18%, rgba(255,255,255,0.3), transparent 44%)"
          }}
        />
        <svg
          width="150"
          height="150"
          viewBox="0 0 132 132"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: "relative" }}
        >
          <path d="M44 24V82" stroke="rgba(255,255,255,0.26)" strokeWidth="5.5" strokeLinecap="round" />
          <path d="M66 20V86" stroke="rgba(255,255,255,0.34)" strokeWidth="7" strokeLinecap="round" />
          <path d="M88 24V82" stroke="rgba(255,255,255,0.26)" strokeWidth="5.5" strokeLinecap="round" />
          <rect x="34" y="34" width="64" height="52" rx="16" fill="rgba(255,255,255,0.12)" stroke="white" strokeWidth="6" />
          <path d="M40 44L66 62L92 44" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M74 33L106 20L92 54" stroke="white" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="106" cy="20" r="3.5" fill="white" />
        </svg>
      </div>
    ),
    size
  );
}
