import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";

import { requireApiUser } from "@/lib/api-auth";
import {
  buildProspectExportWorkbook,
  deleteProspectExport,
  readProspectExport
} from "@/services/prospects/prospect-export";
import { GET } from "@/app/api/prospects/exports/[id]/route";

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: vi.fn()
}));

vi.mock("@/services/prospects/prospect-export", () => ({
  buildProspectExportWorkbook: vi.fn(() => Buffer.from("xlsx-bytes")),
  deleteProspectExport: vi.fn(async () => {}),
  readProspectExport: vi.fn()
}));

const mockedRequireApiUser = vi.mocked(requireApiUser);
const mockedReadProspectExport = vi.mocked(readProspectExport);
const mockedBuildProspectExportWorkbook = vi.mocked(buildProspectExportWorkbook);
const mockedDeleteProspectExport = vi.mocked(deleteProspectExport);

function context(id = "export_1") {
  return { params: Promise.resolve({ id }) };
}

describe("prospect export download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROSPECT_GRAPH_ENABLED = "true";
  });

  it("requires authentication before returning an XLSX", async () => {
    mockedRequireApiUser.mockResolvedValue({
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 })
    });

    const response = (await GET(new Request("http://localhost/api/prospects/exports/export_1"), context())) as Response;

    expect(response.status).toBe(401);
    expect(mockedReadProspectExport).not.toHaveBeenCalled();
  });

  it("streams the short-lived workbook for the authenticated owner and deletes the token", async () => {
    mockedRequireApiUser.mockResolvedValue({
      user: { id: "user_1", email: "owner@example.com" } as User
    });
    mockedReadProspectExport.mockResolvedValue({
      userId: "user_1",
      fileName: "sendloom-esri-all-prospects-2026-06-18.xlsx",
      createdAt: "2026-06-18T00:00:00.000Z",
      rows: []
    });

    const response = (await GET(new Request("http://localhost/api/prospects/exports/export_1"), context())) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toContain("sendloom-esri-all-prospects-2026-06-18.xlsx");
    expect(mockedBuildProspectExportWorkbook).toHaveBeenCalledWith([]);
    expect(mockedDeleteProspectExport).toHaveBeenCalledWith("export_1");
  });
});
