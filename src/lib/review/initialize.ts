/**
 * Builds the initial review state for a fresh draft.
 *
 * Every Category 2 editor starts holding its mock placeholder, unreviewed. A
 * field whose scan found nothing starts empty instead — pre-filling a placeholder
 * that describes snippets that do not exist would be its own small lie.
 */

import type {
  KnowledgeBaseDraft,
  Category2Field,
  Category2VisualField,
} from "@/types/knowledge";
import type { Cat2EditorState, ReviewState } from "@/types/review";
import { category2Fields } from "@/lib/schema/fields";
import { getAtPath } from "@/lib/utils/paths";
import { isReviewed, mockPlaceholderFor } from "@/lib/mock/placeholders";

export function initialReviewState(draft: KnowledgeBaseDraft): ReviewState {
  const cat2: ReviewState["cat2"] = {};

  for (const spec of category2Fields()) {
    // Art Style's evidence is images rather than snippets; `mockPlaceholderFor`
    // branches on the value's own shape, so nothing here needs to know which.
    const field = (getAtPath(draft, spec.path) ?? { status: "absent" }) as
      | Category2Field
      | Category2VisualField;
    const placeholder = mockPlaceholderFor(spec.path, field);
    cat2[spec.path] = { value: placeholder, placeholder, reviewed: false };
  }

  return { cat2 };
}

/**
 * The whole blur transition for a Category 2 editor, as a pure function.
 *
 * This exists so the transition is testable. The original reviewed-state bug —
 * requiring non-empty content, which silently demoted a deliberate blank-out
 * back to unreviewed — lived in an inline `onBlur` handler in the component,
 * where no test could reach it. Extracting `isReviewed` alone was not enough:
 * the tests then covered the predicate while the component was still free to
 * re-add a length guard around it. Now the component's handler is a single
 * delegating call, so the logic that can be wrong is the logic that is tested.
 *
 * Evaluated at blur rather than on every keystroke so a half-typed edit doesn't
 * flip the flag early.
 */
export function blurEditorState(value: string, state: Cat2EditorState): Cat2EditorState {
  return { ...state, value, reviewed: isReviewed(value, state.placeholder) };
}

/**
 * Should the Reviewed / Unreviewed badge be shown at all?
 *
 * Display only. This deliberately does NOT touch `blurEditorState` or
 * `isReviewed` — the reviewed flag is still computed exactly as before for every
 * field, and `draftToFinal` still reads it. What changes is whether the badge is
 * worth drawing.
 *
 * An absent field with an empty editor was rendering three indicators saying the
 * same thing: an "Unreviewed" badge, the `MissingState` "Not found" badge below
 * it, and the empty-evidence hint in the right-hand panel. The badge is the one
 * to drop, because it is the only one of the three that is *wrong* rather than
 * merely redundant — "Unreviewed" implies there is something here a reviewer has
 * not looked at yet, and there is nothing here at all. `MissingState` says the
 * true thing.
 *
 * Extracted as a pure function rather than inlined for the same reason
 * `blurEditorState` was: the last bug in this component lived in an expression
 * no test could reach.
 *
 * The case this must NOT swallow — and `scripts/flows.ts` asserts it — is the
 * deliberate blank-out. A reviewer who clears a mock placeholder and leaves the
 * field empty has made a real decision, and their "Reviewed" badge has to stay.
 * That case is safe here by construction: a placeholder only exists when the
 * scan found something, so `status` is `found` and this returns true before the
 * emptiness test is ever reached.
 */
export function shouldShowReviewBadge(
  status: "found" | "absent",
  state: Cat2EditorState,
): boolean {
  if (status === "found") return true;
  const untouched = state.value === state.placeholder;
  return state.value.trim().length > 0 && !untouched;
}

/** Count of Category 2 fields the reviewer has actually touched. */
export function reviewedCount(review: ReviewState): { reviewed: number; total: number } {
  const entries = Object.values(review.cat2);
  return {
    reviewed: entries.filter((entry) => entry.reviewed).length,
    total: entries.length,
  };
}
