export type PaginationParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

type PaginationOptions = {
  defaultPageSize?: number;
  maxPageSize?: number;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGE_SIZE = 100;

function parsePositiveInteger(value: string | string[] | undefined, fallback: number) {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = normalized ? Number.parseInt(normalized, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPaginationParams(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
  options: PaginationOptions = {}
): PaginationParams {
  const defaultPageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageSize = options.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE;
  const rawPage = input instanceof URLSearchParams ? input.get("page") ?? undefined : input.page;
  const rawPageSize = input instanceof URLSearchParams ? input.get("pageSize") ?? undefined : input.pageSize;
  const page = parsePositiveInteger(rawPage, DEFAULT_PAGE);
  const pageSize = Math.min(parsePositiveInteger(rawPageSize, defaultPageSize), maxPageSize);

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize
  };
}

export function getPaginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1
  };
}
