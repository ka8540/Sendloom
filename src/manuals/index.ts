import type { ManualConfig } from "@/components/manual/manualTypes";
import { campaignDetailManual } from "@/manuals/campaignDetailManual";
import { campaignsManual } from "@/manuals/campaignsManual";
import { finderManual } from "@/manuals/finderManual";
import { importsManual } from "@/manuals/importsManual";
import { templatesManual } from "@/manuals/templatesManual";
import { workspaceManual } from "@/manuals/workspaceManual";

const routeManuals: Record<string, ManualConfig> = {
  "/workspace": workspaceManual,
  "/finder": finderManual,
  "/imports": importsManual,
  "/templates": templatesManual,
  "/campaigns": campaignsManual
};

export function getManualForPathname(pathname: string): ManualConfig | null {
  if (/^\/(?:campaigns|sequences)\/[^/]+$/.test(pathname)) {
    return campaignDetailManual;
  }

  return routeManuals[pathname] ?? null;
}
