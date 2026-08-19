"use client";

import type { FieldSpec } from "@/lib/schema/fields";
import type { Cat2EditorState } from "@/types/review";
import type { MissingCause } from "@/components/shared/MissingState";
import { Category1Field } from "./Category1Field";
import { Category2FieldView } from "./Category2Field";
import { Category3Field } from "./Category3Field";

/**
 * One field, in either edit or read mode, dispatched on its category.
 *
 * The same component renders the /knowledge review form and the read-only
 * Detailed view on /knowledge/view — which is the point of driving everything off
 * the field registry. Two hand-maintained copies of a forty-field layout would
 * drift within a week.
 */

export type FieldRowProps = {
  spec: FieldSpec;
  value: unknown;
  mode: "edit" | "read";
  editor?: Cat2EditorState;
  /** Set when the scan ended `partial`, so empties can say so instead of "not found". */
  scanIncomplete?: boolean;
  sectionHidden?: boolean;
  onValueChange?: (path: string, next: unknown) => void;
  onCat2Change?: (path: string, next: Cat2EditorState) => void;
};

function missingCauseFor(props: FieldRowProps): MissingCause {
  if (props.sectionHidden) return "hidden";
  if (props.scanIncomplete) return "scan-incomplete";
  return "not-found";
}

export function FieldRow(props: FieldRowProps) {
  const { spec, value, mode, editor, onValueChange, onCat2Change } = props;
  const missingCause = missingCauseFor(props);

  return (
    <div
      id={`field-${spec.path}`}
      className="scroll-mt-24 border-t border-ink-100 py-3 first:border-t-0 first:pt-0"
    >
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="field-label">{spec.label}</span>
        {spec.required && (
          <span className="rounded-full bg-danger-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger-600">
            Required
          </span>
        )}
        <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
          Cat {spec.category}
        </span>
      </div>
      {/* Review UI only. These are disambiguation aids for someone actively
          editing — on the read-only Detailed view they are clutter, because
          nobody browsing a saved profile is deciding what belongs in a field. */}
      {mode === "edit" && spec.help && <p className="hint mb-2">{spec.help}</p>}

      {spec.category === 1 && (
        <Category1Field
          spec={spec}
          value={value}
          mode={mode}
          missingCause={missingCause}
          onChange={(next) => onValueChange?.(spec.path, next)}
        />
      )}

      {spec.category === 2 && (
        <Category2FieldView
          spec={spec}
          value={value as never}
          mode={mode}
          editor={editor}
          missingCause={missingCause}
          onChange={(next) => onCat2Change?.(spec.path, next)}
        />
      )}

      {spec.category === 3 && (
        <Category3Field
          spec={spec}
          value={value}
          mode={mode}
          missingCause={missingCause}
          onChange={(next) => onValueChange?.(spec.path, next)}
        />
      )}
    </div>
  );
}
