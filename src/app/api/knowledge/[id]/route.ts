/**
 * GET    /api/knowledge/:id            — one saved knowledge base + section status.
 * DELETE /api/knowledge/:id?mode=soft  — soft delete (default), reversible.
 * DELETE /api/knowledge/:id?mode=hard  — hard delete, irreversible.
 * PATCH  /api/knowledge/:id            — { action: "restore" }.
 */

import { NextRequest } from "next/server";
import { repository } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const row = await repository().get(id);
  if (!row) return Response.json({ error: "Not found." }, { status: 404 });

  const [sections, versions] = await Promise.all([
    repository().sectionStatus(id),
    repository().versions(row.companyId),
  ]);

  return Response.json({
    row,
    sections,
    versionCount: versions.length + 1,
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const mode = request.nextUrl.searchParams.get("mode") ?? "soft";

  const row = await repository().get(id);
  if (!row) return Response.json({ error: "Not found." }, { status: 404 });

  if (mode === "hard") {
    await repository().hardDelete(id);
    return Response.json({ ok: true, mode: "hard" });
  }

  await repository().softDelete(id);
  return Response.json({ ok: true, mode: "soft" });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  let action: string;
  try {
    const body = (await request.json()) as { action?: unknown };
    action = typeof body.action === "string" ? body.action : "";
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (action !== "restore") {
    return Response.json({ error: `Unknown action "${action}".` }, { status: 400 });
  }

  await repository().restore(id);
  return Response.json({ ok: true });
}
