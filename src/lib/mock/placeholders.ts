/**
 * Mock LLM output.
 *
 * No live LLM call is made anywhere in this build. Every Category 2 field is
 * pre-filled with an unmistakable stand-in rather than a confident-sounding fake
 * synthesis.
 *
 * This is a deliberate product decision, not laziness. A convincing fake
 * ("Warm, approachable prose with short declarative sentences…") would be
 * indistinguishable from real output, so a reviewer would skim it, accept it, and
 * ship copy grounded in nothing. A placeholder that reads as a placeholder makes
 * the system's actual state legible — which is the same reason absent fields say
 * why they are absent.
 *
 * The real prompts these stand in for are in /prompts.
 */

import type { Category2Field, Category2VisualField } from "@/types/knowledge";
import { getFieldSpec } from "@/lib/schema/fields";

export const MOCK_PREFIX = "[Mock placeholder —";

/**
 * Art Style gets its own wording, because the generic one would be false here.
 *
 * Every other placeholder says an LLM *would* synthesise this field from the
 * snippets below. For Art Style there are no snippets and no text to synthesise
 * from: the evidence is pictures, and producing this field means looking at
 * them. Saying "an LLM would synthesise from 0 snippets" would misdescribe both
 * the input and the kind of call required — a vision-capable model, which this
 * build does not make, rather than the text completion the other three prompts
 * in `/prompts` stand in for.
 *
 * Worth being precise about, because a reviewer reading the generic wording
 * would reasonably conclude this field is blocked on the same missing API key as
 * the others. It is blocked on different infrastructure.
 */
function artStylePlaceholder(imageCount: number): string {
  return `${MOCK_PREFIX} this field cannot be written from text. Describing composition, colour and typography means looking at the ${imageCount} image${
    imageCount === 1 ? "" : "s"
  } shown here, and nothing in this scraper opens an image — it can only locate them. In production this needs a vision-capable model (see /prompts/04-art-style-vision.md) or your own eyes. No AI has run. Describe what you see, or clear this and leave it blank.]`;
}

/** The text pre-filled into a Category 2 editor when evidence was found. */
export function mockPlaceholderFor(
  fieldPath: string,
  field: Category2Field | Category2VisualField,
): string {
  const spec = getFieldSpec(fieldPath);
  const label = spec?.label ?? fieldPath;

  if (field.status === "absent") {
    return "";
  }

  if ("images" in field) {
    return artStylePlaceholder(field.images.length);
  }

  const count = field.snippets.length;
  const sources = Array.from(new Set(field.snippets.map((snippet) => snippet.source)));
  const sourceList = sources.join(", ");

  return `${MOCK_PREFIX} in production an LLM would synthesise ${label} from the ${count} source snippet${
    count === 1 ? "" : "s"
  } below (found on: ${sourceList}). No AI has run on this text. Replace it with the real value, or edit the snippets down yourself.]`;
}

/** True when the editor still holds the untouched placeholder. */
export function isUnchangedPlaceholder(value: string, placeholder: string): boolean {
  return value.trim() === placeholder.trim();
}

export function isMockText(value: string): boolean {
  return value.trimStart().startsWith(MOCK_PREFIX);
}

/**
 * Has a human actually reviewed this field?
 *
 * The rule is deliberately about *change*, not about content:
 *
 *   | started with        | now contains        | reviewed |
 *   |---------------------|---------------------|----------|
 *   | mock placeholder    | mock placeholder    | no       |
 *   | mock placeholder    | edited mock text    | no       |
 *   | mock placeholder    | real prose          | yes      |
 *   | mock placeholder    | **nothing**         | **yes**  |
 *   | nothing (absent)    | nothing             | no       |
 *   | nothing (absent)    | real prose          | yes      |
 *
 * The fourth row is the one worth stating out loud. Clearing the placeholder and
 * leaving the field blank is a real review decision — "I read the snippets and
 * there is nothing honest to say here" — and it must stay distinguishable from
 * never having looked at the field. Requiring non-empty content would silently
 * demote that judgment back to unreviewed and ask the reviewer to make it again.
 *
 * The fifth row is why the test is `untouched` rather than `changed-from-mock`:
 * a field that began empty and is still empty genuinely carries no evidence that
 * anyone opened it.
 */
export function isReviewed(value: string, placeholder: string): boolean {
  if (isUnchangedPlaceholder(value, placeholder)) return false;
  // Editing the placeholder's wording is not reviewing it.
  return !isMockText(value.trim());
}

/**
 * Output of prompt 3, surfaced as a standalone insight in the review/detail UI.
 * Deliberately NOT a KnowledgeBase property: it is an observation about the data,
 * not part of the company's profile, and it depends on Ideal Persona already
 * being resolved to final text.
 */
export type PersonaFitInsight = {
  alignment: "aligned" | "partial" | "diverged" | "insufficient_data";
  observations: string[];
  confidence: "low" | "medium" | "high";
  /** Always true in this build. Kept explicit so the UI cannot forget to say so. */
  isMock: boolean;
};

export function mockPersonaFit(
  personaText: string | null,
  testimonialCount: number,
): PersonaFitInsight {
  // The one branch that is real logic rather than a placeholder: with no
  // testimonials there is nothing to compare, and the honest answer is to say so
  // rather than to produce a comparison of one block against nothing.
  if (testimonialCount === 0) {
    return {
      alignment: "insufficient_data",
      observations: [
        "No testimonials were found on this site, so there is no evidence of who the actual customers are to compare against the stated persona.",
      ],
      confidence: "high",
      isMock: false,
    };
  }

  if (!personaText || personaText.trim().length === 0) {
    return {
      alignment: "insufficient_data",
      observations: [
        "Ideal Customer Persona has not been resolved to final text yet. This comparison runs after that field is reviewed — it reads the resolved persona, not the raw snippets.",
      ],
      confidence: "high",
      isMock: false,
    };
  }

  return {
    alignment: "partial",
    observations: [
      `${MOCK_PREFIX} in production an LLM would compare the resolved Ideal Customer Persona against the ${testimonialCount} testimonial${
        testimonialCount === 1 ? "" : "s"
      } on file and name specific points of alignment and divergence. No AI has run. The alignment value shown is a stand-in and should not be read as a finding.]`,
    ],
    confidence: "low",
    isMock: true,
  };
}
