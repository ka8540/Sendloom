import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PEOPLE_PAGE_SIZE,
  PEOPLE_QUERY,
  PROSPECT_SEARCHES_QUERY,
  REFRESH_COMPANY_EMAIL_FORMAT_MUTATION,
  SEARCHES_PAGE_SIZE,
  DELETE_COMPANY_MUTATION,
  SET_COMPANY_EMAIL_INFERENCE_OVERRIDE_MUTATION,
  buildPeopleVariables,
  buildSearchesVariables,
  isDisabledResponse,
  prospectGraphql
} from "@/components/prospects/prospect-graphql";

describe("prospect graphql helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("people query defaults to 20, never 5", () => {
    it("defaults `first` to 20 when not provided", () => {
      const vars = buildPeopleVariables({ companyId: "c1" });
      expect(vars.first).toBe(20);
      expect(vars.first).not.toBe(5);
      expect(PEOPLE_PAGE_SIZE).toBe(20);
    });

    it("sends a null category for the All-people view", () => {
      expect(buildPeopleVariables({ companyId: "c1" }).category).toBeNull();
    });

    it("passes the selected positionCategory through", () => {
      const vars = buildPeopleVariables({ companyId: "c1", category: "SOFTWARE_ENGINEERING" });
      expect(vars.category).toBe("SOFTWARE_ENGINEERING");
      expect(vars.companyId).toBe("c1");
    });

    it("honours an explicit page size and cursor", () => {
      const vars = buildPeopleVariables({ companyId: "c1", first: 40, after: "cursor-1" });
      expect(vars.first).toBe(40);
      expect(vars.after).toBe("cursor-1");
    });

    it("declares a parameterised People query", () => {
      expect(PEOPLE_QUERY).toContain("people(companyId: $companyId, positionCategory: $category, first: $first");
    });
  });

  it("defaults searches page size to 20", () => {
    expect(buildSearchesVariables().first).toBe(20);
    expect(SEARCHES_PAGE_SIZE).toBe(20);
  });

  it("requests website and email domains separately", () => {
    expect(PEOPLE_QUERY).toContain("inferredEmail");
    expect(PROSPECT_SEARCHES_QUERY).toContain("officialWebsiteDomain");
    expect(PROSPECT_SEARCHES_QUERY).toContain("emailDomain");
  });

  it("declares the delete-company mutation", () => {
    expect(DELETE_COMPANY_MUTATION).toContain("deleteCompany(companyId: $companyId)");
  });

  it("declares email-format refresh and manual override mutations", () => {
    expect(REFRESH_COMPANY_EMAIL_FORMAT_MUTATION).toContain("refreshCompanyEmailFormat(companyId: $companyId");
    expect(REFRESH_COMPANY_EMAIL_FORMAT_MUTATION).toContain("sourceUrl: $sourceUrl");
    expect(SET_COMPANY_EMAIL_INFERENCE_OVERRIDE_MUTATION).toContain("setCompanyEmailInferenceOverride");
  });

  describe("isDisabledResponse", () => {
    it("treats a 404 as disabled", () => {
      expect(isDisabledResponse(404, null)).toBe(true);
    });

    it("treats a 'not enabled' error body as disabled", () => {
      expect(isDisabledResponse(200, { error: "Prospect graph is not enabled." })).toBe(true);
    });

    it("does not treat a normal payload as disabled", () => {
      expect(isDisabledResponse(200, { data: { prospectSearches: { edges: [] } } })).toBe(false);
    });
  });

  describe("prospectGraphql request wrapper", () => {
    it("reports disabled when the endpoint returns 404", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ error: "Prospect graph is not enabled." }), { status: 404 }))
      );
      const result = await prospectGraphql("{ __typename }");
      expect(result.disabled).toBe(true);
      expect(result.data).toBeNull();
    });

    it("returns a generic, safe error instead of raw GraphQL error text", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({ errors: [{ message: "Invalid `prisma.x` invocation: secret internal detail" }] }),
              { status: 200 }
            )
        )
      );
      const result = await prospectGraphql("{ __typename }");
      expect(result.disabled).toBe(false);
      expect(result.error).toBe("We couldn't complete that request.");
      expect(result.error).not.toContain("prisma");
    });

    it("passes through safe prospect GraphQL errors", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                errors: [
                  {
                    message:
                      "No web search provider configured. Paste a public email-format source URL or set WEB_SEARCH_PROVIDER to serper/brave with its API key.",
                    extensions: { code: "FORBIDDEN" }
                  }
                ]
              }),
              { status: 200 }
            )
        )
      );
      const result = await prospectGraphql("{ __typename }");
      expect(result.error).toContain("No web search provider configured");
      expect(result.error).toContain("WEB_SEARCH_PROVIDER");
    });

    it("returns data on success", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }))
      );
      const result = await prospectGraphql<{ ok: boolean }>("{ ok }");
      expect(result.error).toBeNull();
      expect(result.data).toEqual({ ok: true });
    });

    it("handles a thrown network error gracefully", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("boom");
        })
      );
      const result = await prospectGraphql("{ __typename }");
      expect(result.disabled).toBe(false);
      expect(result.error).toMatch(/network/i);
    });
  });
});
