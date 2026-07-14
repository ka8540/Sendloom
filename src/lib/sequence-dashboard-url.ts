import {
  ALL_SENDER_ACCOUNTS,
  type SequenceFilterId
} from "@/lib/sequence-dashboard";

export const SEQUENCE_DASHBOARD_QUERY_KEYS = ["status", "sender", "q", "page"] as const;

export type SequenceDashboardUrlState = {
  filter: SequenceFilterId;
  sender: string;
  query: string;
  page: number;
};

const STATUS_PARAM_BY_FILTER: Record<SequenceFilterId, string | null> = {
  all: null,
  active: "active",
  paused: "paused",
  attention: "needs-attention",
  completed: "completed",
  scheduled: "scheduled",
  draft: "draft"
};

const FILTER_BY_STATUS_PARAM = new Map<string, SequenceFilterId>([
  ["active", "active"],
  ["paused", "paused"],
  ["needs-attention", "attention"],
  ["attention", "attention"],
  ["completed", "completed"],
  ["scheduled", "scheduled"],
  ["draft", "draft"]
]);

type SearchParamsReader = Pick<URLSearchParams, "get" | "toString">;

export function readSequenceDashboardUrlState(
  searchParams: SearchParamsReader,
  senderEmails: readonly string[]
): SequenceDashboardUrlState {
  const statusParam = searchParams.get("status")?.trim().toLowerCase() ?? "";
  const requestedSender = searchParams.get("sender")?.trim() ?? "";
  const sender =
    senderEmails.find((email) => email.toLowerCase() === requestedSender.toLowerCase()) ??
    ALL_SENDER_ACCOUNTS;
  const pageParam = searchParams.get("page") ?? "";
  const parsedPage = Number(pageParam);

  return {
    filter: FILTER_BY_STATUS_PARAM.get(statusParam) ?? "all",
    sender,
    query: searchParams.get("q") ?? "",
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  };
}

export function updateSequenceDashboardSearchParams(
  current: SearchParamsReader | string,
  patch: Partial<SequenceDashboardUrlState>
) {
  const params = new URLSearchParams(
    typeof current === "string" ? current : current.toString()
  );

  if (patch.filter !== undefined) {
    const status = STATUS_PARAM_BY_FILTER[patch.filter];
    if (status) {
      params.set("status", status);
    } else {
      params.delete("status");
    }
  }

  if (patch.sender !== undefined) {
    if (patch.sender) {
      params.set("sender", patch.sender);
    } else {
      params.delete("sender");
    }
  }

  if (patch.query !== undefined) {
    if (patch.query.trim()) {
      params.set("q", patch.query);
    } else {
      params.delete("q");
    }
  }

  if (patch.page !== undefined) {
    if (patch.page > 1) {
      params.set("page", String(patch.page));
    } else {
      params.delete("page");
    }
  }

  return params;
}

export function normalizeSequenceDashboardSearchParams(
  current: SearchParamsReader | string,
  state: SequenceDashboardUrlState,
  page: number
) {
  return updateSequenceDashboardSearchParams(current, {
    filter: state.filter,
    sender: state.sender,
    query: state.query,
    page
  });
}

export function buildSequenceDashboardReturnTo(pathname: string, searchParams: SearchParamsReader) {
  const dashboardPath = pathname === "/sequences" ? "/sequences" : "/campaigns";
  const query = searchParams.toString();
  return query ? `${dashboardPath}?${query}` : dashboardPath;
}

export function buildSequenceDetailHref(sequenceId: string, returnTo: string) {
  return `/campaigns/${encodeURIComponent(sequenceId)}?returnTo=${encodeURIComponent(returnTo)}`;
}
