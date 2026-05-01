import type { ManualConfig } from "@/components/manual/manualTypes";

export const workspaceManual: ManualConfig = {
  id: "workspace",
  routeLabel: "Workspace overview",
  steps: [
    {
      id: "command-center",
      title: "Command center",
      body: "Use this page as the live operating surface. It rolls up active sequences, recent send volume, validation posture, and anything that needs attention.",
      selector: "main.content > div:not(.content-toolbar)",
      placement: "right"
    },
    {
      id: "metrics",
      title: "Read the operating signals",
      body: "The top metrics show whether the workspace is moving: active workflows, usable lists, and template inventory. Treat them as quick health checks before launching more sends.",
      selector: "main.content a[href='/campaigns']:not(.button), main.content a[href='/imports']:not(.button), main.content a[href='/templates']:not(.button)",
      placement: "bottom"
    },
    {
      id: "sequence-entry",
      title: "Jump into live work",
      body: "Recent sequence rows are entry points into the campaigns that changed most recently. Open one to review setup, delivery state, replies, and controls.",
      selector: "main.content a[href^='/sequences/'], main.content a[href='/campaigns']",
      placement: "top"
    }
  ]
};
