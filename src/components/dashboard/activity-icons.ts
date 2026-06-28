import {
  Activity,
  Building2,
  CircleCheck,
  FilePenLine,
  FileSpreadsheet,
  MailSearch,
  MessageSquareReply,
  Search,
  SendHorizontal,
  ShieldBan,
  Trash2,
  TriangleAlert,
  UserRoundPlus,
  UsersRound,
  Workflow,
  type LucideIcon
} from "lucide-react";

import type { ActivityEventType, ActivityItem } from "@/components/dashboard/types";

// Each newer Discover/Finder activity maps to its own task-appropriate glyph.
// Failure events are handled separately (see getActivityIcon) so they keep the
// existing restrained warning icon regardless of their event type.
const ACTIVITY_EVENT_ICONS: Record<ActivityEventType, LucideIcon> = {
  discover_search_created: Search,
  discover_search_ready: UsersRound,
  discover_search_failed: TriangleAlert,
  discover_people_added: UserRoundPlus,
  discover_results_exported: FileSpreadsheet,
  finder_email_found: MailSearch,
  finder_domain_search: Building2
};

export function getActivityIcon(item: ActivityItem): LucideIcon {
  const activityText = `${item.title} ${item.description}`.toLowerCase();

  // Failures always use the warning glyph, ahead of any per-type mapping, so the
  // feed's existing restrained error styling is preserved.
  if (isFailureActivity(item, activityText)) {
    return TriangleAlert;
  }

  // Newer Discover/Finder rows carry an explicit event type for a deterministic
  // icon; everything else falls back to the original keyword/kind heuristics.
  const eventIcon = item.eventType ? ACTIVITY_EVENT_ICONS[item.eventType] : undefined;
  if (eventIcon) {
    return eventIcon;
  }

  if (matchesAny(activityText, ["deleted", "removed", "trashed"])) {
    return Trash2;
  }

  if (item.kind === "suppression") {
    return ShieldBan;
  }

  if (item.kind === "import") {
    return FileSpreadsheet;
  }

  if (item.kind === "template") {
    return FilePenLine;
  }

  if (item.kind === "run") {
    if (matchesAny(activityText, ["reply", "replied", "response received"])) {
      return MessageSquareReply;
    }

    if (matchesAny(activityText, ["ready", "validated"])) {
      return CircleCheck;
    }

    if (matchesAny(activityText, ["send", "sending", "sent", "launch", "launched", "running", "queued"])) {
      return SendHorizontal;
    }

    return Workflow;
  }

  if (matchesAny(activityText, ["template", "copy refreshed"])) {
    return FilePenLine;
  }

  if (matchesAny(activityText, ["import", ".csv", ".xlsx", ".xls", "rows are ready", "list ready", "mapping ready"])) {
    return FileSpreadsheet;
  }

  if (matchesAny(activityText, ["suppression", "unsubscribe", "blocked"])) {
    return ShieldBan;
  }

  if (matchesAny(activityText, ["hunter", "finder", "domain search", "email finder", "found emails", "enriched contacts"])) {
    return Search;
  }

  if (matchesAny(activityText, ["ready", "validated"])) {
    return CircleCheck;
  }

  if (matchesAny(activityText, ["reply", "replied", "response received"])) {
    return MessageSquareReply;
  }

  if (matchesAny(activityText, ["sequence", "campaign", "launch", "launched", "send", "sending", "sent"])) {
    return SendHorizontal;
  }

  return Activity;
}

export function getActivityTone(item: ActivityItem): ActivityItem["tone"] {
  const activityText = `${item.title} ${item.description}`.toLowerCase();

  if (isFailureActivity(item, activityText)) {
    return "warning";
  }

  if (item.tone === "success" || matchesAny(activityText, ["ready", "validated", "clean delivery"])) {
    return "success";
  }

  return item.tone;
}

function isFailureActivity(item: ActivityItem, activityText: string) {
  if (item.tone === "warning") {
    return true;
  }

  if (matchesAny(activityText, ["failed", "failure", "error", "bounced", "invalid", "rejected", "warning", "attention required"])) {
    return true;
  }

  if (matchesAny(activityText, ["0 issues", "no issues", "all clear"])) {
    return false;
  }

  return /\b[1-9]\d*\s+issues?\b/.test(activityText);
}

function matchesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}
