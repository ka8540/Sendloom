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
          background: "linear-gradient(135deg, #fbf6ea, #e8dcc4)",
          color: "#ae3f1d",
          fontSize: 72,
          fontWeight: 700
        }}
      >
        MP
      </div>
    ),
    size
  );
}
