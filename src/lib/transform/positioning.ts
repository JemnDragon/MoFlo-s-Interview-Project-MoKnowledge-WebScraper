/**
 * Positioning: Pitch (required) and Founding Story (optional).
 *
 * Pitch and Overview are drawn from overlapping source material but are not the
 * same field — Overview is third-person and factual, Pitch is second-person and
 * persuasive. The transform's job is only to hand each of them the right raw
 * passages; the rewriting is the LLM's job (see /prompts/02-overview-pitch.md),
 * and until that runs, both carry an honest placeholder.
 */

import signalFile from "@/data/content-signals.json";
import type { DraftPositioning, Snippet } from "@/types/knowledge";
import {
  bundle,
  MAX_EXTRACTIVE_SNIPPETS,
  MAX_POSITIONING_SNIPPETS,
  snippetsMatching,
} from "./helpers";
import {
  allSnippets,
  orderPositioning,
  pageSnippets,
  pagesOfType,
  type TransformContext,
} from "./context";

/**
 * Pitch shares one candidate pool with Overview and orders it its own way: the
 * homepage hero first — an h1/h2 is where a site makes its pitch — then the
 * declared description, then homepage prose, with About prose last.
 *
 * Exactly the inverse of Overview's ordering, over exactly the same candidates.
 * The About-page fallback is gone as a special case for the same reason
 * Overview's homepage fallback is: About passages are always in the pool now,
 * they simply rank last, so a homepage that yields nothing surfaces them
 * automatically instead of through a branch that only fired on total silence.
 */
function pitchSnippets(context: TransformContext): Snippet[] {
  return orderPositioning(context, "pitch");
}

function foundingStorySnippets(context: TransformContext): Snippet[] {
  const aboutFirst = [
    ...pagesOfType(context, "about").flatMap(pageSnippets),
    ...allSnippets(context),
  ];
  // Optional field: no homepage fallback. If nothing states a founding story,
  // the honest answer is that the site does not tell one.
  return snippetsMatching(aboutFirst, signalFile.foundingStory);
}

export function transformPositioning(context: TransformContext): DraftPositioning {
  return {
    pitch: bundle(pitchSnippets(context), MAX_POSITIONING_SNIPPETS),
    foundingStory: bundle(foundingStorySnippets(context), MAX_EXTRACTIVE_SNIPPETS),
  };
}
