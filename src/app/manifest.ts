import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sendloom",
    short_name: "Sendloom",
    description: "Professional sequence sending and outreach operations app",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1824",
    theme_color: "#167c5a",
    icons: [
      {
        src: "/icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any"
      }
    ]
  };
}
