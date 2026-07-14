import type { ManualConfig } from "@/components/manual/manualTypes";
import { adminManual } from "@/manuals/adminManual";
import { campaignDetailManual } from "@/manuals/campaignDetailManual";
import { campaignCreateManual, campaignsManual } from "@/manuals/campaignsManual";
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
  // The create page shares the /campaigns/[id] URL shape, so it must be
  // matched before the detail-page pattern.
  if (pathname === "/campaigns/new" || pathname === "/sequences/new") {
    return campaignCreateManual;
  }

  if (/^\/(?:campaigns|sequences)\/[^/]+$/.test(pathname)) {
    return campaignDetailManual;
  }

  // Every admin route (overview, users, restrictions, system-health, activity)
  // shares one adaptive guide; its steps are filtered to the visible section.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return adminManual;
  }

  // Discover detail workspace (/prospects/[searchId]) gets the search-specific
  // results guide; the bare /prospects list page gets the Search History guide.
  if (/^\/prospects\/[^/]+$/.test(pathname)) {
    return discoverDetailManual;
  }

  return routeManuals[pathname] ?? null;
}
