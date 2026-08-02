import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COMPANY_DETAIL_QUERY,
  CREATE_PROSPECT_IMPORT_MUTATION,
  DISCOVER_COMPANY_EMAIL_FORMAT_MUTATION,
  PEOPLE_PAGE_SIZE,
  PEOPLE_QUERY,
  PREPARE_PROSPECT_EXPORT_MUTATION,
  PROCESS_SEARCH_MUTATION,
  PROSPECT_SEARCHES_QUERY,
  REVIEW_PROSPECT_SELECTION_MUTATION,
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

  describe("people query defaults to 10 per page", () => {
    it("defaults `first` to 10 when not provided (#2)", () => {
      const vars = buildPeopleVariables({ companyId: "c1" });
      expect(vars.first).toBe(10);
      expect(vars.first).not.toBe(20);
      expect(PEOPLE_PAGE_SIZE).toBe(10);
    });

    it("sends a null category for the All-people view", () => {
      expect(buildPeopleVariables({ companyId: "c1" }).category).toBeNull();
    });

    it("passes the selected positionCategory through", () => {
      const vars = buildPeopleVariables({ companyId: "c1", category: "SOFTWARE_ENGINEERING" });
      expect(vars.category).toBe("SOFTWARE_ENGINEERING");
      expect(vars.companyId).toBe("c1");
    });

    it("keeps the 10 page size when a category filter is applied (#7)", () => {
      expect(buildPeopleVariables({ companyId: "c1", category: "DATA_SCIENCE" }).first).toBe(10);
      expect(buildPeopleVariables({ companyId: "c1", category: "SOFTWARE_ENGINEERING" }).first).toBe(10);
    });

    it("never uses a page size of 20 for people on this page (#3)", () => {
      expect(buildPeopleVariables({ companyId: "c1" }).first).not.toBe(20);
      expect(PEOPLE_PAGE_SIZE).not.toBe(20);
    });

    it("honours an explicit page size and cursor", () => {
      const vars = buildPeopleVariables({ companyId: "c1", first: 40, after: "cursor-1" });
      expect(vars.first).toBe(40);
      expect(vars.after).toBe("cursor-1");
    });

    it("passes a trimmed server-side People search through", () => {
      expect(buildPeopleVariables({ companyId: "c1", search: "  Louis  " }).search).toBe("Louis");
      expect(buildPeopleVariables({ companyId: "c1", search: "   " }).search).toBeNull();
    });

    it("declares a parameterised People query", () => {
      expect(PEOPLE_QUERY).toContain("$search: String");
      expect(PEOPLE_QUERY).toContain("search: $search");
    });
  });

  it("defaults the search-history page size to 10 (#1)", () => {
    expect(buildSearchesVariables().first).toBe(10);
    expect(SEARCHES_PAGE_SIZE).toBe(10);
  });

  it("passes a cursor through for server-side history pagination", () => {
    expect(buildSearchesVariables({ after: "cursor-2" })).toEqual({ first: 10, after: "cursor-2" });
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

  it("declares prospect selection review, Excel export, and Imports mutations", () => {
    expect(REVIEW_PROSPECT_SELECTION_MUTATION).toContain("reviewProspectSelection(input: $input)");
    expect(PREPARE_PROSPECT_EXPORT_MUTATION).toContain("prepareProspectExport(input: $input)");
    expect(PREPARE_PROSPECT_EXPORT_MUTATION).toContain("downloadUrl");
    expect(CREATE_PROSPECT_IMPORT_MUTATION).toContain("createProspectImport(input: $input)");
    expect(CREATE_PROSPECT_IMPORT_MUTATION).toContain("viewUrl");
  });

  it("declares the AI web-search discovery mutation with a force flag and reason", () => {
    expect(DISCOVER_COMPANY_EMAIL_FORMAT_MUTATION).toContain("discoverCompanyEmailFormat(companyId: $companyId, force: $force)");
    expect(DISCOVER_COMPANY_EMAIL_FORMAT_MUTATION).toContain("emailFormatReason");
    expect(DISCOVER_COMPANY_EMAIL_FORMAT_MUTATION).toContain("emailFormatDiscoveryStatus");
    expect(DISCOVER_COMPANY_EMAIL_FORMAT_MUTATION).toContain("emailFormatDiscoveryReason");
    // The company detail query also exposes the reason so the card can show it.
    expect(COMPANY_DETAIL_QUERY).toContain("emailFormatReason");
    expect(COMPANY_DETAIL_QUERY).toContain("emailFormatDiscoveryStatus");
    expect(PROCESS_SEARCH_MUTATION).toContain("emailFormatDiscoveryStatus");
  });

  it("passes a safe rate-limit / not-configured FORBIDDEN message through to the UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              errors: [
                {
                  message: "You've reached the AI email-format search limit. Try again in about 30 minutes.",
                  extensions: { code: "FORBIDDEN" }
                }
              ]
            }),
            { status: 200 }
          )
      )
    );
    const result = await prospectGraphql("mutation { discoverCompanyEmailFormat(companyId: \"c1\") { id } }");
    expect(result.error).toContain("limit");
    expect(result.error).not.toContain("prisma");
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
