/**
 * POST /api/insights/persona-fit — the testimonials-vs-stated-persona comparison.
 *
 * This is NOT a schema field. Its output is a standalone insight surfaced in the
 * review and detail UIs, not a stored KnowledgeBase property — it is an
 * observation about the data rather than a fact about the company.
 *
 * It also has a pipeline-ordering dependency worth stating out loud: it consumes
 * the *resolved* Ideal Customer Persona text, so it cannot run until that field
 * has been reviewed. Given raw snippets it would be comparing testimonials
 * against a placeholder.
 */

import { NextRequest } from "next/server";
import { mockPersonaFit } from "@/lib/mock/placeholders";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { personaText?: unknown; testimonialCount?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const personaText = typeof body.personaText === "string" ? body.personaText : null;
  const testimonialCount =
    typeof body.testimonialCount === "number" ? body.testimonialCount : 0;

  return Response.json({ insight: mockPersonaFit(personaText, testimonialCount) });
}
