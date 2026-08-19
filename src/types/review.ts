/**
 * Review-time state.
 *
 * Kept separate from `KnowledgeBaseDraft` on purpose. The draft is the pure
 * product of the transform layer — the same RawScrape must always produce the
 * same draft. What a human then typed into a field, and whether they have
 * reviewed it, is a different kind of fact with a different lifetime, so it
 * lives in its own structure and is passed alongside the draft into
 * `draftToFinal()`.
 */

import type { KnowledgeBaseDraft } from "./knowledge";

export type Cat2EditorState = {
  /** What the user currently has in the field. */
  value: string;
  /** The mock placeholder this field started with, for change detection. */
  placeholder: string;
  /**
   * Flips to true at blur, the moment the content differs from the placeholder.
   * There is no separate confirm button — a field the user has actually rewritten
   * is reviewed by definition, and asking them to also click "confirm" is a
   * second, ignorable step.
   */
  reviewed: boolean;
};

export type ReviewState = {
  /** Keyed by FieldSpec.path. */
  cat2: Record<string, Cat2EditorState>;
};

/**
 * What the review page holds: the draft (mutated in place for Category 1 and 3
 * edits, which are plain values) plus the Category 2 editor states.
 */
export type WorkingDraft = {
  draft: KnowledgeBaseDraft;
  review: ReviewState;
  /** Server-side scan id, used by the retry action to resume the right crawl. */
  scanId: string | null;
};
