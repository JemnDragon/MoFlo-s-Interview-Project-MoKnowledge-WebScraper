/**
 * PATCH /api/knowledge/:id/sections — hide or restore one category section.
 *
 * Soft-only by design: there is no hard-delete at section granularity. A section
 * is a slice of a scraped snapshot, not a user-authored object, so "permanently
 * destroy the Key People data but keep the record" has no honest meaning — a
 * re-scan would just bring it back.
 */

import { NextRequest } from "next/server";
import { repository } from "@/lib/db";
import { CATEGORY_GROUP_IDS, type CategoryGroupId } from "@/types/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function isCategoryGroupId(value: unknown): value is CategoryGroupId {
  return typeof value === "string" && (CATEGORY_GROUP_IDS as readonly string[]).includes(value);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  let body: { section?: unknown; hidden?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!isCategoryGroupId(body.section)) {
    return Response.json({ error: "Unknown section name." }, { status: 400 });
  }
  if (typeof body.hidden !== "boolean") {
    return Response.json({ error: "hidden must be a boolean." }, { status: 400 });
  }

  const row = await repository().get(id);
  if (!row) return Response.json({ error: "Not found." }, { status: 404 });

  const status = await repository().setSectionHidden(id, body.section, body.hidden);
  return Response.json({ status });
}
