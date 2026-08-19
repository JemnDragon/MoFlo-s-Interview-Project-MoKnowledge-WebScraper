"use client";

import { CATEGORY_GROUP_LABELS, type CategoryGroupId } from "@/types/knowledge";
import { fieldsInGroup } from "@/lib/schema/fields";
import type { Cat2EditorState, ReviewState } from "@/types/review";
import { getAtPath } from "@/lib/utils/paths";
import { FieldRow } from "./FieldRow";

/**
 * One schema category, rendered as a block.
 *
 * Shared by the review UI (edit mode) and the Detailed view (read mode), so the
 * grouping a reviewer learns while building a profile is the same grouping they
 * see when reading it back.
 *
 * Section-level delete lives here: small and contextual, soft-only, and always
 * paired with a restore affordance. A hide control with no visible way back is
 * how data quietly disappears.
 */

export type CategoryGroupBlockProps = {
  group: CategoryGroupId;
  record: unknown;
  mode: "edit" | "read";
  review?: ReviewState;
  scanIncomplete?: boolean;
  hidden?: boolean;
  onToggleHidden?: (group: CategoryGroupId, hidden: boolean) => void;
  onValueChange?: (path: string, next: unknown) => void;
  onCat2Change?: (path: string, next: Cat2EditorState) => void;
};

export function CategoryGroupBlock({
  group,
  record,
  mode,
  review,
  scanIncomplete,
  hidden = false,
  onToggleHidden,
  onValueChange,
  onCat2Change,
}: CategoryGroupBlockProps) {
  const specs = fieldsInGroup(group);

  return (
    <section
      className={`card p-4 ${hidden ? "border-dashed bg-hidden-100/60" : ""}`}
      aria-labelledby={`group-${group}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`group-${group}`} className="text-sm font-bold tracking-tight text-ink-900">
          {CATEGORY_GROUP_LABELS[group]}
          {hidden && (
            <span className="ml-2 rounded-full bg-hidden-100 px-2 py-0.5 text-[11px] font-semibold text-hidden-600">
              Hidden
            </span>
          )}
        </h3>

        {onToggleHidden && (
          <button
            type="button"
            onClick={() => onToggleHidden(group, !hidden)}
            className={`rounded border px-2 py-1 text-xs font-medium ${
              hidden
                ? "border-accent-500 text-accent-600 hover:bg-accent-100"
                : "border-ink-200 text-ink-500 hover:border-hidden-600 hover:text-hidden-600"
            }`}
          >
            {hidden ? "Restore section" : "Hide section"}
          </button>
        )}
      </div>

      {hidden ? (
        <p className="hint">
          This section is hidden on this profile. Its data is still stored and is excluded from the
          completeness score rather than counted as missing. Restore it to see the fields again.
        </p>
      ) : (
        <div>
          {specs.map((spec) => (
            <FieldRow
              key={spec.path}
              spec={spec}
              value={getAtPath(record, spec.path)}
              mode={mode}
              editor={review?.cat2[spec.path]}
              scanIncomplete={scanIncomplete}
              onValueChange={onValueChange}
              onCat2Change={onCat2Change}
            />
          ))}
        </div>
      )}
    </section>
  );
}
