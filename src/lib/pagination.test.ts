import { describe, expect, it } from "vitest";

import { getPaginationMeta, getPaginationParams } from "@/lib/pagination";

describe("pagination helpers", () => {
  it("parses positive page values and computes database offsets", () => {
    const pagination = getPaginationParams(new URLSearchParams("page=3&pageSize=25"));

    expect(pagination).toEqual({
      page: 3,
      pageSize: 25,
      skip: 50,
      take: 25
    });
  });

  it("enforces the configured max page size", () => {
    const pagination = getPaginationParams(new URLSearchParams("page=1&pageSize=500"), {
      defaultPageSize: 20,
      maxPageSize: 100
    });

    expect(pagination.pageSize).toBe(100);
    expect(pagination.take).toBe(100);
  });

  it("returns consistent pagination metadata", () => {
    expect(getPaginationMeta(2, 10, 21)).toEqual({
      page: 2,
      pageSize: 10,
      total: 21,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true
    });
  });
});
