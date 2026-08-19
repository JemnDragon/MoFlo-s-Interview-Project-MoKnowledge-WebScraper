"use client";

import type {
  Category2Field as Category2Value,
  Category2VisualField,
} from "@/types/knowledge";
import type { FieldSpec } from "@/lib/schema/fields";
import type { Cat2EditorState } from "@/types/review";
import { isMockText } from "@/lib/mock/placeholders";
import { blurEditorState, shouldShowReviewBadge } from "@/lib/review/initialize";
import { SnippetList } from "./SnippetList";
import { ImageEvidenceList } from "./ImageEvidenceList";
import { MissingState, type MissingCause } from "@/components/shared/MissingState";

/**
 * Category 2 editor: a text area pre-filled with the honestly-labelled mock
 * placeholder, with the source-tagged snippets shown alongside it.
 *
 * Review semantics: the field flips from unreviewed to reviewed at blur, the
 * moment its content differs from the placeholder it started with. No separate
 * confirm button — a reviewer who has rewritten the text has, by any reasonable
 * definition, reviewed it, and a second click to say so is a step people learn to
 * click without reading.
 *
 * The layout is snippets-beside-editor on desktop and stacked on mobile, done
 * with a plain CSS grid breakpoint. No JavaScript is involved in that decision.
 */

type Props = {
  spec: FieldSpec;
  /** Draft value (evidence bundle) in edit mode; resolved string in read mode. */
  value: Category2Value | Category2VisualField | string | null;
  mode: "edit" | "read";
  editor?: Cat2EditorState;
  missingCause: MissingCause;
  onChange?: (next: Cat2EditorState) => void;
};

/**
 * Both the empty-textarea hint and the empty-evidence-panel message are worded
 * per evidence kind. "The scan found no source content" is accurate for a
 * snippet field and misleading for Art Style, where what is missing is an image
 * — a reviewer who reads "no content" may go looking for text that was never
 * the input.
 */
const EVIDENCE_COPY = {
  snippets: {
    emptyEditor: "The scan found no source content for this field. Write it yourself, or leave it empty.",
    emptyPanel: "No source snippets — nothing on the scanned pages matched this field.",
  },
  images: {
    emptyEditor: "No image was found to describe. Write it yourself if you know the brand, or leave it empty.",
    emptyPanel:
      "No candidate image — no logo, header image or og:image was found on the scanned pages. There is nothing to look at, so there is nothing to describe.",
  },
} as const;

export function Category2FieldView({ spec, value, mode, editor, missingCause, onChange }: Props) {
  if (mode === "read") {
    const text = typeof value === "string" ? value : null;
    if (!text || text.trim().length === 0) return <MissingState cause={missingCause} compact />;
    return <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-900">{text}</p>;
  }

  const field = (value ?? { status: "absent" }) as Category2Value | Category2VisualField;
  const state: Cat2EditorState = editor ?? { value: "", placeholder: "", reviewed: false };
  const showingMock = isMockText(state.value);
  const copy = EVIDENCE_COPY[spec.evidence ?? "snippets"];
  const showBadge = shouldShowReviewBadge(field.status, state);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-1.5">
        <textarea
          value={state.value}
          className={showingMock ? "is-mock" : undefined}
          placeholder={field.status === "absent" ? copy.emptyEditor : undefined}
          aria-label={spec.label}
          onChange={(event) => onChange?.({ ...state, value: event.target.value })}
          // The whole transition lives in `blurEditorState` so it is testable —
          // this handler must stay a single delegating call. In particular, do
          // NOT reintroduce a non-empty check here: clearing the placeholder and
          // leaving the field blank is a deliberate review decision, and
          // `scripts/flows.ts` asserts both the behaviour and the shape of this
          // handler to keep that regression from creeping back in.
          onBlur={(event) => onChange?.(blurEditorState(event.target.value, state))}
        />
        {/* Whether to draw the badge is decided in `shouldShowReviewBadge`, not
            here — display only, and the reviewed flag itself is untouched. The
            row collapses entirely when neither child renders, so an absent field
            does not leave a stray gap under its textarea. */}
        {(showBadge || showingMock) && (
          <div className="flex flex-wrap items-center gap-2">
            {showBadge &&
              (state.reviewed ? (
                <span className="rounded-full bg-good-100 px-2 py-0.5 text-[11px] font-semibold text-good-600">
                  Reviewed
                </span>
              ) : (
                <span className="rounded-full bg-mock-100 px-2 py-0.5 text-[11px] font-semibold text-mock-600">
                  Unreviewed
                </span>
              ))}
            {showingMock && (
              <span className="hint">
                This is placeholder text, not AI output. It will never be saved.
              </span>
            )}
          </div>
        )}
        {field.status === "absent" && <MissingState cause={missingCause} compact />}
      </div>

      <div>
        {field.status === "absent" ? (
          <p className="hint rounded-lg border border-dashed border-ink-200 bg-ink-50 px-3 py-2">
            {copy.emptyPanel}
          </p>
        ) : "images" in field ? (
          <ImageEvidenceList images={field.images} />
        ) : (
          <SnippetList snippets={field.snippets} display={spec.snippetDisplay ?? "collapsed"} />
        )}
      </div>
    </div>
  );
}
