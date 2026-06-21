import type { ManualConfig } from "@/components/manual/manualTypes";
import { campaignDetailManual } from "@/manuals/campaignDetailManual";
import { campaignsManual } from "@/manuals/campaignsManual";
import { discoverDetailManual, discoverListManual } from "@/manuals/discoverManual";
import { finderManual } from "@/manuals/finderManual";
import { importsManual } from "@/manuals/importsManual";
import { templatesManual } from "@/manuals/templatesManual";
import { workspaceManual } from "@/manuals/workspaceManual";

const routeManuals: Record<string, ManualConfig> = {
  "/workspace": workspaceManual,
  "/finder": finderManual,
  "/imports": importsManual,
  "/templates": templatesManual,
  "/campaigns": campaignsManual,
  "/prospects": discoverListManual
};

export function getManualForPathname(pathname: string): ManualConfig | null {
  if (/^\/(?:campaigns|sequences)\/[^/]+$/.test(pathname)) {
    return campaignDetailManual;
  }

  // Discover detail workspace (/prospects/[searchId]) gets the search-specific
  // results guide; the bare /prospects list page gets the Search History guide.
  if (/^\/prospects\/[^/]+$/.test(pathname)) {
    return discoverDetailManual;
  }

  return routeManuals[pathname] ?? null;
}
