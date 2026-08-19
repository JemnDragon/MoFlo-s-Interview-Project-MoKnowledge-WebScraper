"use client";

import type { ValidationProblem } from "@/lib/validate/draftToFinal";
import type { Completeness } from "@/lib/validate/completeness";
import { CompletenessBar } from "@/components/shared/CompletenessBar";

/**
 * Save control.
 *
 * When the save is blocked it names the exact fields and the exact reason for
 * each. "Please complete the form" tells a reviewer nothing they can act on, and
 * on a forty-field page it is close to hostile.
 */
export function SaveBar({
  completeness,
  problems,
  reviewed,
  totalCat2,
  saving,
  onSave,
}: {
  completeness: Completeness;
  problems: ValidationProblem[];
  reviewed: number;
  totalCat2: number;
  saving: boolean;
  onSave: () => void;
}) {
  const blocked = problems.length > 0;

  return (
    <div className="card sticky bottom-4 z-10 p-4 shadow-lg shadow-ink-900/5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-[220px] flex-1">
          <CompletenessBar completeness={completeness} />
          <p className="hint mt-1">
            {reviewed} of {totalCat2} synthesis fields reviewed
          </p>
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={blocked || saving}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            blocked || saving
              ? "cursor-not-allowed bg-ink-100 text-ink-400"
              : "bg-accent-500 text-white hover:bg-accent-hover"
          }`}
        >
          {saving ? "Saving…" : "Save knowledge base"}
        </button>
      </div>

      {blocked && (
        <div className="mt-3 rounded-lg border border-danger-600/25 bg-danger-100 p-3">
          <p className="text-xs font-semibold text-danger-600">
            {problems.length} required field{problems.length === 1 ? "" : "s"} still unsatisfied:
          </p>
          <ul className="mt-1.5 space-y-1">
            {problems.map((problem) => (
              <li key={problem.fieldPath} className="text-xs leading-relaxed text-danger-600">
                <a href={`#field-${problem.fieldPath}`} className="font-semibold underline">
                  {problem.label}
                </a>{" "}
                — {problem.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
