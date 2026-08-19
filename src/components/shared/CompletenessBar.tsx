"use client";

import type { Completeness } from "@/lib/validate/completeness";

/**
 * One completeness indicator, used on the review page, the card grid, the table
 * and the detail view, so the number always means the same thing.
 *
 * Hidden fields are reported separately from never-found ones. The score itself
 * does not penalise hidden sections — see the reasoning in completeness.ts.
 */
export function CompletenessBar({
  completeness,
  compact = false,
}: {
  completeness: Completeness;
  compact?: boolean;
}) {
  const { score, populated, counted, hiddenCount } = completeness;
  const tone =
    score >= 70 ? "bg-good-600" : score >= 40 ? "bg-mock-500" : "bg-danger-600";

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-2">
        <span className={compact ? "text-[11px] text-ink-500" : "field-label"}>
          {compact ? "Completeness" : "Completeness"}
        </span>
        <span
          className={
            compact ? "text-[11px] font-semibold text-ink-700" : "text-sm font-semibold text-ink-700"
          }
        >
          {score}%
        </span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Knowledge base completeness"
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${score}%` }} />
      </div>
      {!compact && (
        <p className="hint mt-1">
          {populated} of {counted} fields populated
          {hiddenCount > 0 && (
            <>
              {" · "}
              <span className="text-hidden-600">
                {hiddenCount} field{hiddenCount === 1 ? "" : "s"} hidden by you, excluded from the
                score
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
