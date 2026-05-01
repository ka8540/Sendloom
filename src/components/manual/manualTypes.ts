export type ManualPlacement = "top" | "right" | "bottom" | "left" | "center";

export type ManualStep = {
  id: string;
  title: string;
  body: string;
  selector?: string;
  placement?: ManualPlacement;
};

export type ManualConfig = {
  id: string;
  routeLabel: string;
  steps: ManualStep[];
};
