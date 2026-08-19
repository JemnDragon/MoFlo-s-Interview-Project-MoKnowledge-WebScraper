/**
 * GET  /api/knowledge — list saved knowledge bases (filters + search).
 * POST /api/knowledge — validate a draft and save it.
 */

import { NextRequest } from "next/server";
import { repository } from "@/lib/db";
import { draftToFinal } from "@/lib/validate/draftToFinal";
import { computeCompleteness } from "@/lib/validate/completeness";
import type { KnowledgeBaseDraft } from "@/types/knowledge";
import type { ReviewState } from "@/types/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const [items, facets] = await Promise.all([
    repository().list({
      industry: params.get("industry"),
      language: params.get("language"),
      search: params.get("search"),
      includeDeleted: params.get("includeDeleted") === "true",
    }),
    repository().facets(),
  ]);
  return Response.json({ items, facets });
}

export async function POST(request: NextRequest) {
  let payload: { draft?: KnowledgeBaseDraft; review?: ReviewState };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { draft, review } = payload;
  if (!draft || !review) {
    return Response.json({ error: "Both draft and review state are required." }, { status: 400 });
  }

  // The server runs the same validation the client's save button runs. The
  // client copy exists for immediate feedback; this copy is the one that decides.
  const result = draftToFinal(draft, review);
  if (!result.ok) {
    return Response.json({ error: "Required fields are unsatisfied.", problems: result.problems }, {
      status: 422,
    });
  }

  const completeness = computeCompleteness(draft);
  const row = await repository().save({
    knowledgeBase: result.knowledgeBase,
    completenessScore: completeness.score,
  });

  return Response.json({ id: row.id, companyId: row.companyId }, { status: 201 });
}
