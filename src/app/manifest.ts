import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sendloom",
    short_name: "Sendloom",
    description: "Professional sequence sending and outreach operations app",
    start_url: "/",
    display: "standalone",
    background_color: "#f5efe2",
    theme_color: "#ae3f1d",
    icons: []
  };
}
