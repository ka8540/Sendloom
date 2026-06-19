import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { requireApiUser } from "@/lib/api-auth";
import {
  buildProspectExportWorkbook,
  deleteProspectExport,
  readProspectExport
} from "@/services/prospects/prospect-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORT_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function contentDisposition(fileName: string) {
  const fallback = fileName.replace(/["\\\r\n]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!env.PROSPECT_GRAPH_ENABLED) {
    return NextResponse.json({ error: "Prospect Finder is not available right now." }, { status: 404 });
  }

  const auth = await requireApiUser();
  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await params;
  const exportPayload = await readProspectExport(id, auth.user.id);
  if (!exportPayload) {
    return NextResponse.json({ error: "Export link expired. Prepare the export again." }, { status: 404 });
  }

  const workbook = buildProspectExportWorkbook(exportPayload.rows);
  await deleteProspectExport(id).catch(() => {});

  return new Response(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "content-type": EXPORT_MIME_TYPE,
      "content-disposition": contentDisposition(exportPayload.fileName),
      "cache-control": "no-store"
    }
  });
}
